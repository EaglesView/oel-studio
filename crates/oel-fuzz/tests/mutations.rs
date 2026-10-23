//! A short, fixed pass of the damaged-file harness on every fixture: a panic found by a longer run
//! (`cargo run -p oel-fuzz --profile fuzz -- --seconds 3600`) and then fixed stays fixed.

use oelfuzz::{Rng, Seed, check, damaged, fixtures, quiet_panics};

/// Damaged copies per fixture; small enough for a debug `cargo test`.
const PER_FIXTURE: usize = 8;
/// Bigger fixtures spend a debug build's time in (de)compression; the release runs take them all.
const MAX_FIXTURE_BYTES: usize = 1 << 20;

#[test]
fn damaged_fixtures_never_panic() {
    quiet_panics();
    let seeds: Vec<Seed> = fixtures().iter().filter_map(|p| Seed::load(p)).filter(|s| s.bytes.len() <= MAX_FIXTURE_BYTES).collect();
    assert!(seeds.len() >= 20, "fixtures not found ({} read)", seeds.len());
    let mut rng = Rng::new(0x5eed);
    let mut crashes = Vec::new();
    for s in &seeds {
        // The fixture itself first: it must import and export.
        if let Some(c) = check(s.codec, &s.bytes) {
            crashes.push(format!("{} (as is): {} at {}", s.path.display(), c.message, c.location));
        }
        for i in 0..PER_FIXTURE {
            let input = damaged(&s.pkg, &s.bytes, &mut rng);
            if let Some(c) = check(s.codec, &input) {
                crashes.push(format!("{} (copy {i}): {} at {}", s.path.display(), c.message, c.location));
            }
        }
    }
    assert!(crashes.is_empty(), "panics on damaged files:\n{}", crashes.join("\n"));
}
