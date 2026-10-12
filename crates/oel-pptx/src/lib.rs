//! oel-pptx: lossless `.pptx` ↔ deck JSON codec for the OutilsEnLigne
//! presentation editor (`@oel/slides`).
//!
//! - [`read`]: `.pptx` → [`model::Deck`] (slides, layouts, masters; what
//!   PowerPoint inherits resolved for display) plus the media it shows;
//! - [`write`]: deck JSON + original package → `.pptx`, patching only what the
//!   editor changed; untouched parts are copied byte for byte;
//! - [`template`]: the package new presentations start from;
//! - [`wasm`]: the wasm-bindgen surface used by the engine worker and Node.

pub mod model;
pub mod read;
pub mod table;
pub mod template;
pub mod text;
pub mod theme;
pub mod write;

pub use model::{Deck, Imported, Media};
pub use write::export_pptx;

pub fn import_pptx(bytes: &[u8]) -> Result<Imported, String> {
    let pkg = oel_opc::package::Package::read(bytes)?;
    read::import_package(&pkg)
}

/// A new presentation (the built-in template, one title slide), as an import.
pub fn new_deck() -> Imported {
    let mut imp = read::import_package(&template::package()).expect("template presentation");
    imp.deck.source = model::Source::New;
    imp
}

// Bindings only with `--features wasm` (built by `npm run build:wasm`); tests and native hosts skip them.
#[cfg(feature = "wasm")]
pub mod wasm;
