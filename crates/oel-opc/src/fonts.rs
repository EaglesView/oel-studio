//! Fonts shared by the codecs: open substitutes for the usual Office fonts
//! (so every machine renders a file alike) and the de-obfuscation of fonts
//! embedded in a package (ECMA-376 Part 2).

/// An open font standing in for a Word font.
pub struct Substitute {
    /// Word font names it replaces (lower case).
    pub word: &'static [&'static str],
    /// A metric-compatible or look-alike font often installed locally, tried first.
    pub local: Option<&'static str>,
    /// The web font the editor self-hosts (`@fontsource/*`) and loads on demand.
    pub open: &'static str,
    pub generic: &'static str,
    /// Licence of `open`.
    pub licence: &'static str,
}

/// Substitutes, metric-compatible ones first. All web fonts are SIL OFL 1.1 (via Fontsource).
pub const SUBSTITUTES: &[Substitute] = &[
    Substitute { word: &["calibri", "aptos"], local: None, open: "Carlito", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["cambria"], local: None, open: "Caladea", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["arial", "helvetica"], local: Some("Liberation Sans"), open: "Arimo", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["times new roman", "times"], local: Some("Liberation Serif"), open: "Tinos", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["courier new", "courier"], local: Some("Liberation Mono"), open: "Cousine", generic: "monospace", licence: "OFL-1.1" },
    Substitute { word: &["georgia"], local: None, open: "Gelasio", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["century gothic"], local: Some("TeX Gyre Adventor"), open: "Questrial", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["felix titling"], local: None, open: "Cinzel", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["gill sans", "gill sans mt"], local: None, open: "Lato", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["segoe ui", "segoe ui light", "segoe ui semibold"], local: None, open: "Open Sans", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["consolas", "lucida console"], local: None, open: "Inconsolata", generic: "monospace", licence: "OFL-1.1" },
    Substitute { word: &["garamond", "adobe garamond pro"], local: None, open: "EB Garamond", generic: "serif", licence: "OFL-1.1" },
    Substitute { word: &["franklin gothic book", "franklin gothic medium", "franklin gothic demi"], local: None, open: "Libre Franklin", generic: "sans-serif", licence: "OFL-1.1" },
    Substitute { word: &["trebuchet ms"], local: None, open: "Fira Sans", generic: "sans-serif", licence: "OFL-1.1" },
];

/// The substitute for a font, also for a family's variants (`Gill Sans Nova Light`
/// falls back on `Gill Sans`): trailing words are dropped until a name matches.
pub fn substitute_for(name: &str) -> Option<&'static Substitute> {
    let n = name.trim().to_ascii_lowercase();
    let mut words: Vec<&str> = n.split_whitespace().collect();
    while !words.is_empty() {
        let candidate = words.join(" ");
        if let Some(s) = SUBSTITUTES.iter().find(|s| s.word.contains(&candidate.as_str())) {
            return Some(s);
        }
        words.pop();
    }
    None
}

/// CSS font stack: the Word font, then its local and web substitutes, then a generic family.
pub fn css_font(name: &str) -> String {
    let name = name.replace('"', "");
    match substitute_for(&name) {
        Some(s) => {
            let local = s.local.map(|l| format!("\"{l}\", ")).unwrap_or_default();
            format!("\"{name}\", {local}\"{}\", {}", s.open, s.generic)
        }
        None => format!("\"{name}\", sans-serif"),
    }
}

/// XOR the first 32 bytes with the font key (GUID bytes reversed, twice), per ECMA-376 Part 2.
pub fn deobfuscate(data: &mut [u8], font_key: &str) -> bool {
    let hex: String = font_key.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 {
        return false;
    }
    let mut key = [0u8; 16];
    for (i, k) in key.iter_mut().enumerate() {
        *k = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }
    key.reverse();
    for (i, b) in data.iter_mut().take(32).enumerate() {
        *b ^= key[i % 16];
    }
    true
}

fn is_sfnt(b: &[u8]) -> bool {
    b.len() > 12 && (b.starts_with(&[0, 1, 0, 0]) || b.starts_with(b"OTTO") || b.starts_with(b"true") || b.starts_with(b"ttcf"))
}

/// The OpenType/TrueType data of an embedded font part, as a browser loads it:
/// a plain font file, or an Embedded OpenType wrapper (PowerPoint's `.fntdata`)
/// when its data is not MicroType-Express compressed (XOR-encrypted data is
/// decrypted). `None` for anything else: the editor then uses the substitute.
pub fn sfnt_from_embedded(bytes: &[u8]) -> Option<Vec<u8>> {
    if is_sfnt(bytes) {
        return Some(bytes.to_vec());
    }
    let u32_at = |o: usize| bytes.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let magic = bytes.get(34..36).map(|b| u16::from_le_bytes([b[0], b[1]]));
    if magic != Some(0x504C) {
        return None;
    }
    let (eot, size, flags) = (u32_at(0)?, u32_at(4)?, u32_at(12)?);
    const COMPRESSED: usize = 0x4;
    const XOR: usize = 0x1000_0000;
    if flags & COMPRESSED != 0 || eot > bytes.len() || size > eot {
        return None;
    }
    let mut data = bytes[eot - size..eot].to_vec();
    if flags & XOR != 0 {
        for b in &mut data {
            *b ^= 0x50;
        }
    }
    is_sfnt(&data).then_some(data)
}

/// File extension and mime of font data (`ttf` / `otf`).
pub fn font_kind(data: &[u8]) -> (&'static str, &'static str) {
    if data.starts_with(b"OTTO") { ("otf", "font/otf") } else { ("ttf", "font/ttf") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stacks_put_the_office_font_first() {
        assert_eq!(css_font("Felix Titling"), "\"Felix Titling\", \"Cinzel\", serif");
        assert_eq!(css_font("Century Gothic"), "\"Century Gothic\", \"TeX Gyre Adventor\", \"Questrial\", sans-serif");
        assert_eq!(css_font("Calibri"), "\"Calibri\", \"Carlito\", sans-serif");
        assert_eq!(css_font("Mystery"), "\"Mystery\", sans-serif");
        assert_eq!(substitute_for("Gill Sans Nova Light").map(|s| s.open), Some("Lato"));
        assert_eq!(substitute_for("Times New Roman").map(|s| s.open), Some("Tinos"));
        assert!(substitute_for("Times Square Display").is_some_and(|s| s.open == "Tinos"));
    }

    /// An EOT wrapper around `font`: header (with the 0x504C magic at 34), then the data.
    pub fn eot(font: &[u8], flags: u32) -> Vec<u8> {
        let mut h = vec![0u8; 82];
        let total = (h.len() + font.len()) as u32;
        h[0..4].copy_from_slice(&total.to_le_bytes());
        h[4..8].copy_from_slice(&(font.len() as u32).to_le_bytes());
        h[8..12].copy_from_slice(&0x0002_0001u32.to_le_bytes());
        h[12..16].copy_from_slice(&flags.to_le_bytes());
        h[34..36].copy_from_slice(&0x504Cu16.to_le_bytes());
        let body: Vec<u8> = if flags & 0x1000_0000 != 0 { font.iter().map(|b| b ^ 0x50).collect() } else { font.to_vec() };
        [h, body].concat()
    }

    #[test]
    fn embedded_fonts_are_unwrapped() {
        let ttf: Vec<u8> = [&[0u8, 1, 0, 0][..], &[7u8; 40][..]].concat();
        assert_eq!(sfnt_from_embedded(&ttf).as_deref(), Some(&ttf[..]));
        assert_eq!(sfnt_from_embedded(&eot(&ttf, 0)).as_deref(), Some(&ttf[..]));
        assert_eq!(sfnt_from_embedded(&eot(&ttf, 0x1000_0000)).as_deref(), Some(&ttf[..]));
        // MicroType Express compression: not for browsers.
        assert_eq!(sfnt_from_embedded(&eot(&ttf, 0x4)), None);
        assert_eq!(sfnt_from_embedded(b"not a font at all, really"), None);
        assert_eq!(font_kind(b"OTTO...."), ("otf", "font/otf"));
    }

    #[test]
    fn deobfuscation_is_its_own_inverse() {
        let original: Vec<u8> = (0..64).collect();
        let mut data = original.clone();
        assert!(deobfuscate(&mut data, "{6C3B2F1A-9D4E-4B7A-8E21-0F5A3C9D7B64}"));
        assert_ne!(data, original);
        assert_eq!(&data[32..], &original[32..]);
        deobfuscate(&mut data, "{6C3B2F1A-9D4E-4B7A-8E21-0F5A3C9D7B64}");
        assert_eq!(data, original);
        assert!(!deobfuscate(&mut data, "not a guid"));
    }
}
