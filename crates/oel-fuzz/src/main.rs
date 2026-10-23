//! Damage the fixtures and run each codec on them until time or iterations run out.
//!
//! ```text
//! cargo run -p oel-fuzz --profile fuzz -- --seconds 3600            # every fixture, round robin, one hour
//! cargo run -p oel-fuzz --profile fuzz -- --iterations 300 a.docx   # 300 damaged copies of one file
//! cargo run -p oel-fuzz --profile fuzz -- --replay target/oel-fuzz/docx-1.docx
//! ```
//!
//! The `fuzz` profile keeps overflow checks, so arithmetic that would wrap silently in WASM panics here.
//! Each distinct panic (by source location) is saved under `--out` (default `target/oel-fuzz`) as the
//! damaged file that caused it; the exit code is 1 when there was any. A failure that ends the process
//! (an allocation too big to make aborts, it doesn't panic) leaves its input as `last.<ext>` there.

use oelfuzz::{Codec, Rng, Seed, check, damaged, fixtures, quiet_panics};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn main() {
    let mut seconds: Option<u64> = None;
    let mut iterations: Option<u64> = None;
    let mut seed = 0x9e37_79b9_7f4a_7c15_u64;
    let mut out = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/oel-fuzz"));
    let mut replay: Option<PathBuf> = None;
    let mut paths = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage(&format!("{a} needs a value")));
        match a.as_str() {
            "--seconds" => seconds = Some(value().parse().unwrap_or_else(|_| usage("--seconds: a number"))),
            "--iterations" => iterations = Some(value().parse().unwrap_or_else(|_| usage("--iterations: a number"))),
            "--seed" => seed = value().parse().unwrap_or_else(|_| usage("--seed: a number")),
            "--out" => out = PathBuf::from(value()),
            "--replay" => replay = Some(PathBuf::from(value())),
            "-h" | "--help" => usage(""),
            _ if a.starts_with('-') => usage(&format!("unknown option {a}")),
            _ => paths.push(PathBuf::from(a)),
        }
    }

    if let Some(file) = replay {
        let codec = Codec::of(&file).unwrap_or_else(|| usage("--replay: a .docx, .xlsx or .pptx"));
        let bytes = std::fs::read(&file).unwrap_or_else(|e| usage(&format!("{}: {e}", file.display())));
        quiet_panics();
        match check(codec, &bytes) {
            Some(c) => {
                println!("panic at {}: {}", c.location, c.message);
                std::process::exit(1);
            }
            None => println!("no panic"),
        }
        return;
    }

    let paths = if paths.is_empty() { fixtures() } else { paths };
    let seeds: Vec<Seed> = paths.iter().filter_map(|p| Seed::load(p)).collect();
    if seeds.is_empty() {
        usage("no readable .docx, .xlsx or .pptx file");
    }
    let deadline = seconds.map(|s| Instant::now() + Duration::from_secs(s));
    let rounds = iterations.unwrap_or(if deadline.is_some() { u64::MAX } else { 100 });
    std::fs::create_dir_all(&out).expect("output directory");
    quiet_panics();

    let mut rng = Rng::new(seed);
    let mut crashes: BTreeMap<String, (String, PathBuf)> = BTreeMap::new();
    let mut runs = 0u64;
    let started = Instant::now();
    'outer: for round in 0..rounds {
        for s in &seeds {
            if deadline.is_some_and(|d| Instant::now() >= d) {
                break 'outer;
            }
            let input = damaged(&s.pkg, &s.bytes, &mut rng);
            std::fs::write(out.join(format!("last.{}", s.codec.ext())), &input).expect("write the current input");
            runs += 1;
            if let Some(c) = check(s.codec, &input) {
                if !crashes.contains_key(&c.location) {
                    let file = out.join(format!("{}-{}.{}", s.codec.ext(), crashes.len() + 1, s.codec.ext()));
                    std::fs::write(&file, &input).expect("write the damaged file");
                    println!("panic at {} ({}): {}\n    from {}\n    saved {}", c.location, s.codec.ext(), c.message, s.path.display(), file.display());
                    crashes.insert(c.location, (c.message, file));
                }
            }
        }
        if round % 10 == 9 {
            eprintln!("{} runs, {} distinct panics, {:.0?}", runs, crashes.len(), started.elapsed());
        }
    }
    println!("{runs} damaged files from {} fixtures in {:.0?}: {} distinct panics", seeds.len(), started.elapsed(), crashes.len());
    for ext in ["docx", "xlsx", "pptx"] {
        let _ = std::fs::remove_file(out.join(format!("last.{ext}")));
    }
    if !crashes.is_empty() {
        std::process::exit(1);
    }
}

fn usage(problem: &str) -> ! {
    if !problem.is_empty() {
        eprintln!("oel-fuzz: {problem}");
    }
    eprintln!("usage: oel-fuzz [--seconds N | --iterations N] [--seed N] [--out DIR] [FILE…]\n       oel-fuzz --replay FILE");
    std::process::exit(2);
}
