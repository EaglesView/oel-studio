//! Damaged files at the import boundary (backlog T0-5).
//!
//! Every file a person opens goes through `Package::read`, the XML parser and a codec's import; an
//! export then writes it back. A panic there is a crash in the app (a trap in WASM), so damaged
//! input must come back as an error. This harness takes the real fixtures, damages their parts in
//! the ways files are damaged or crafted (hostile numbers, missing or repeated elements, cut or
//! corrupted bytes, a broken zip) and runs import then export, catching panics.
//!
//! Stable Rust and deterministic: a seed gives the same files every time, so a crash found once can
//! be replayed (`cargo run -p oel-fuzz --profile fuzz -- --replay <file>`). `tests/mutations.rs` runs a
//! short fixed pass with `cargo test`; the weekly CI job runs for an hour (`.github/workflows/fuzz.yml`).

use oel_opc::package::Package;
use std::cell::RefCell;
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};

/// xorshift64: small, fast and reproducible from its seed.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// Numbers that overflow, underflow or size an allocation: what crafted files put in counts and indexes.
const NUMBERS: &[&str] = &[
    "0", "-1", "-2147483649", "4294967295", "4294967296", "99999999999999999999", "", "NaN", "1e308", "-0", "65536",
    "1048577", "18446744073709551616", "2147483647", "0.5", "-1e9",
];

/// Markup that breaks a parser when it lands in the wrong place.
const MARKUP: &[&str] = &["<", ">", "&", "&#0;", "&#x110000;", "&unknown;", "]]>", "<!--", "<![CDATA[", "<?x", "\"", "</a>", "<a>", "\u{feff}"];

/// One random change to an XML part, as text (structure-aware) or as bytes.
pub fn mutate_xml(xml: &[u8], r: &mut Rng) -> Vec<u8> {
    if xml.is_empty() {
        return xml.to_vec();
    }
    match r.below(10) {
        0..=5 => mutate_markup(&String::from_utf8_lossy(xml), r).into_bytes(),
        // Cut the part short.
        6 => xml[..r.below(xml.len())].to_vec(),
        // Insert markup at a random byte.
        7 => {
            let at = r.below(xml.len());
            [&xml[..at], MARKUP[r.below(MARKUP.len())].as_bytes(), &xml[at..]].concat()
        }
        // Corrupt one byte (also breaks UTF-8).
        8 => {
            let mut out = xml.to_vec();
            let at = r.below(out.len());
            out[at] ^= 1 << r.below(8);
            out
        }
        // Repeat a stretch of the part (unbalanced tags, duplicated ids).
        _ => {
            let s = r.below(xml.len());
            let e = s + r.below((xml.len() - s).min(400));
            [&xml[..e], &xml[s..]].concat()
        }
    }
}

fn mutate_markup(xml: &str, r: &mut Rng) -> String {
    let b = xml.as_bytes();
    // Byte offsets below are on ASCII characters, so slicing at them stays on char boundaries.
    match r.below(6) {
        // An attribute value becomes a hostile number.
        0 | 1 => {
            let quotes: Vec<usize> = b.iter().enumerate().filter(|(_, c)| **c == b'"').map(|(i, _)| i).collect();
            if quotes.len() < 2 {
                return xml.to_string();
            }
            let k = r.below(quotes.len() / 2) * 2;
            let (s, e) = (quotes[k], quotes[k + 1]);
            format!("{}\"{}\"{}", &xml[..s], NUMBERS[r.below(NUMBERS.len())], &xml[e + 1..])
        }
        // An element's text becomes a hostile number.
        2 => {
            let gts: Vec<usize> = b.iter().enumerate().filter(|(i, c)| **c == b'>' && b.get(i + 1).is_some_and(|n| *n != b'<')).map(|(i, _)| i).collect();
            if gts.is_empty() {
                return xml.to_string();
            }
            let s = gts[r.below(gts.len())] + 1;
            let e = xml[s..].find('<').map(|o| s + o).unwrap_or(xml.len());
            format!("{}{}{}", &xml[..s], NUMBERS[r.below(NUMBERS.len())], &xml[e..])
        }
        // An attribute disappears.
        3 => {
            let eqs: Vec<usize> = b.iter().enumerate().filter(|(i, c)| **c == b'=' && b.get(i + 1) == Some(&b'"')).map(|(i, _)| i).collect();
            if eqs.is_empty() {
                return xml.to_string();
            }
            let q = eqs[r.below(eqs.len())];
            let s = xml[..q].rfind(' ').unwrap_or(q);
            let e = xml[q + 2..].find('"').map(|o| q + 3 + o).unwrap_or(xml.len());
            format!("{}{}", &xml[..s], &xml[e..])
        }
        // An empty element disappears.
        4 => {
            let ends: Vec<usize> = xml.match_indices("/>").map(|(i, _)| i).collect();
            if ends.is_empty() {
                return xml.to_string();
            }
            let e = ends[r.below(ends.len())];
            let s = xml[..e].rfind('<').unwrap_or(e);
            format!("{}{}", &xml[..s], &xml[e + 2..])
        }
        // An empty element is repeated.
        _ => {
            let ends: Vec<usize> = xml.match_indices("/>").map(|(i, _)| i).collect();
            if ends.is_empty() {
                return xml.to_string();
            }
            let e = ends[r.below(ends.len())] + 2;
            let s = xml[..e].rfind('<').unwrap_or(e);
            format!("{}{}", &xml[..e], &xml[s..])
        }
    }
}

/// The codec a fixture goes through, from its extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    Docx,
    Xlsx,
    Pptx,
}

impl Codec {
    pub fn of(path: &Path) -> Option<Codec> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "docx" => Some(Codec::Docx),
            "xlsx" => Some(Codec::Xlsx),
            "pptx" => Some(Codec::Pptx),
            _ => None,
        }
    }
    pub fn ext(self) -> &'static str {
        match self {
            Codec::Docx => "docx",
            Codec::Xlsx => "xlsx",
            Codec::Pptx => "pptx",
        }
    }
}

/// A damaged copy of `pkg` (already read from `original`): one to three XML parts changed, or, now and
/// then, the zip bytes themselves.
pub fn damaged(pkg: &Package, original: &[u8], r: &mut Rng) -> Vec<u8> {
    if r.below(12) == 0 {
        let mut out = original.to_vec();
        for _ in 0..1 + r.below(4) {
            let at = r.below(out.len());
            out[at] = r.next() as u8;
        }
        return out;
    }
    let xml: Vec<usize> = pkg.parts.iter().enumerate().filter(|(_, (n, _))| n.ends_with(".xml") || n.ends_with(".rels")).map(|(i, _)| i).collect();
    let mut p = pkg.clone();
    for _ in 0..1 + r.below(3) {
        let i = xml[r.below(xml.len())];
        p.parts[i].1 = mutate_xml(&p.parts[i].1, r);
    }
    p.write().unwrap_or_else(|_| original.to_vec())
}

thread_local! {
    static PANIC_AT: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Keep panics quiet and remember where the last one happened (the message alone rarely says).
pub fn quiet_panics() {
    std::panic::set_hook(Box::new(|info| {
        let at = info.location().map(|l| l.to_string()).unwrap_or_default();
        PANIC_AT.with(|p| *p.borrow_mut() = Some(at));
    }));
}

/// A panic: where, and what it said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Crash {
    pub location: String,
    pub message: String,
}

/// Import `bytes` with `codec`, then export what was imported; errors are fine, panics are returned.
pub fn check(codec: Codec, bytes: &[u8]) -> Option<Crash> {
    let res = catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
        match codec {
            Codec::Docx => {
                let imp = oeldocx::import_docx(bytes)?;
                let media: HashMap<String, Vec<u8>> = imp.media.into_iter().map(|m| (m.path, m.bytes)).collect();
                oeldocx::export_docx(&imp.json, Some(bytes), media)?;
            }
            Codec::Xlsx => {
                let wb = oelxlsx::import_xlsx(bytes)?;
                oelxlsx::export_xlsx(&wb, Some(bytes))?;
            }
            Codec::Pptx => {
                let imp = oelpptx::import_pptx(bytes)?;
                let media: HashMap<String, Vec<u8>> = imp.media.into_iter().map(|m| (m.path, m.bytes)).collect();
                oelpptx::export_pptx(&imp.deck, Some(bytes), media)?;
            }
        }
        Ok(())
    }));
    let err = res.err()?;
    let message = err.downcast_ref::<String>().cloned().or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
    let location = PANIC_AT.with(|p| p.borrow_mut().take()).unwrap_or_default();
    Some(Crash { location, message })
}

/// The office fixtures of the repository, sorted.
pub fn fixtures() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let mut out = Vec::new();
    let mut dirs = vec![root];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                dirs.push(p);
            } else if Codec::of(&p).is_some() {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

/// A fixture read once, ready to be damaged many times.
pub struct Seed {
    pub path: PathBuf,
    pub codec: Codec,
    pub bytes: Vec<u8>,
    pub pkg: Package,
}

impl Seed {
    pub fn load(path: &Path) -> Option<Seed> {
        let codec = Codec::of(path)?;
        let bytes = std::fs::read(path).ok()?;
        let pkg = Package::read(&bytes).ok()?;
        Some(Seed { path: path.to_path_buf(), codec, bytes, pkg })
    }
}
