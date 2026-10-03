//! oel-xlsx: lossless `.xlsx` / `.csv` codec and IronCalc-based calc
//! engine for the OutilsEnLigne spreadsheet editor (`@oel/sheets`).
//!
//! - [`read`]: `.xlsx` → [`model::Workbook`] JSON;
//! - [`write`]: JSON + original package → `.xlsx`, untouched parts byte for byte;
//! - [`csv`]: delimited text in and out, keeping the file's dialect;
//! - [`engine`]: formulas, computed with IronCalc;
//! - [`wasm`]: the wasm-bindgen surface used by the web worker and Node.

pub mod csv;
pub mod engine;
pub mod model;
pub mod read;
pub mod refs;
pub mod styles;
pub mod template;
pub mod write;

pub use read::import_xlsx;
pub use write::export_xlsx;

/// A blank workbook (one sheet, « Feuille 1 »), as JSON.
pub fn new_workbook() -> model::Workbook {
    let mut wb = import_xlsx(&template::new_package_bytes()).expect("template workbook");
    wb.source = model::Source::New;
    wb
}
// Bindings only with `--features wasm` (built by `npm run build:wasm`); tests and native hosts skip them.
#[cfg(feature = "wasm")]
pub mod wasm;
