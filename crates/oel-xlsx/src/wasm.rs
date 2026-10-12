//! wasm-bindgen surface. JSON strings cross the boundary (the workbook can be
//! large; one `JSON.parse` on the JS side beats walking a JsValue tree).
//!
//! - Codec (stateless): `xlsx_to_model`, `csv_to_model`, `new_workbook_model`,
//!   `model_to_xlsx`, `model_to_csv` — used by the engine worker and by Node.
//! - Calc (stateful): [`WasmCalc`] — used by the calc worker of `@oel/sheets`.

use crate::engine::{Calc, CellInput, Structural};
use crate::model::{CsvDialect, Workbook};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn parse_wb(json: &str) -> Result<Workbook, JsError> {
    serde_json::from_str(json).map_err(|e| js_err(format!("classeur JSON invalide : {e}")))
}

fn to_json<T: serde::Serialize>(v: &T) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(js_err)
}

#[wasm_bindgen]
pub fn xlsx_to_model(bytes: &[u8]) -> Result<String, JsError> {
    to_json(&crate::import_xlsx(bytes).map_err(js_err)?)
}

/// `opts`: `{ delimiter?, encoding?, sheetName? }` as JSON (or empty).
#[wasm_bindgen]
pub fn csv_to_model(bytes: &[u8], opts: &str) -> Result<String, JsError> {
    let opts: crate::csv::CsvOptions = if opts.trim().is_empty() { Default::default() } else { serde_json::from_str(opts).map_err(js_err)? };
    to_json(&crate::csv::import_csv(bytes, &opts).map_err(js_err)?)
}

#[wasm_bindgen]
pub fn new_workbook_model() -> Result<String, JsError> {
    to_json(&crate::new_workbook())
}

/// The original `.xlsx` (when the workbook came from one) is the base the
/// edits are written into; without it a new package is built. `media` is `{path, bytes}[]` for
/// pictures made in the editor (retouched pictures' renderings and originals).
#[wasm_bindgen]
pub fn model_to_xlsx(json: &str, original: Option<Vec<u8>>, media: Option<js_sys::Array>) -> Result<Vec<u8>, JsError> {
    let mut map = std::collections::HashMap::new();
    for item in media.iter().flat_map(|m| m.iter()) {
        let path = js_sys::Reflect::get(&item, &"path".into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let bytes = js_sys::Reflect::get(&item, &"bytes".into()).map(|v| js_sys::Uint8Array::new(&v).to_vec()).unwrap_or_default();
        if !path.is_empty() {
            map.insert(path, bytes);
        }
    }
    crate::export_xlsx_with_media(&parse_wb(json)?, original.as_deref(), map).map_err(js_err)
}

/// One sheet as delimited text. `dialect` (JSON, optional) overrides the file's own.
/// Returns the bytes; characters the encoding cannot hold are written as `?`.
#[wasm_bindgen]
pub fn model_to_csv(json: &str, sheet: usize, dialect: &str) -> Result<Vec<u8>, JsError> {
    let wb = parse_wb(json)?;
    let d: Option<CsvDialect> = if dialect.trim().is_empty() { None } else { Some(serde_json::from_str(dialect).map_err(js_err)?) };
    Ok(crate::csv::export_csv(&wb, sheet, d.as_ref()).map_err(js_err)?.0)
}

/// Preview of a number format (`1234.5`, `#,##0.00 $` → `1,234.50 $`).
#[wasm_bindgen]
pub fn format_number(value: f64, code: &str) -> String {
    Calc::format_number(value, code)
}

/// An opened `.xlsx`, to read parts the editor shows but does not model
/// (images of drawings) without unzipping the file for each one.
#[wasm_bindgen]
pub struct XlsxParts {
    pkg: oel_opc::package::Package,
}

#[wasm_bindgen]
impl XlsxParts {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<XlsxParts, JsError> {
        Ok(XlsxParts { pkg: oel_opc::package::Package::read(bytes).map_err(js_err)? })
    }

    /// The bytes of a part (`xl/media/image1.png`), if the package has it.
    pub fn part(&self, path: &str) -> Option<Vec<u8>> {
        self.pkg.get(path).map(<[u8]>::to_vec)
    }
}

#[wasm_bindgen]
pub struct WasmCalc {
    calc: Calc,
}

#[wasm_bindgen]
impl WasmCalc {
    /// Build the engine from a workbook JSON and compute everything.
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> Result<WasmCalc, JsError> {
        Ok(WasmCalc { calc: Calc::new(&parse_wb(json)?).map_err(js_err)? })
    }

    /// `inputs`: JSON array of `{sheet, r, c, f?, t?, v?, a?, fmt?}`. Returns the
    /// errors (JSON array of strings); nothing is computed until `evaluate`.
    pub fn apply(&mut self, inputs: &str) -> Result<String, JsError> {
        let inputs: Vec<CellInput> = serde_json::from_str(inputs).map_err(js_err)?;
        to_json(&self.calc.apply(&inputs))
    }

    /// `op`: JSON `{op: "insertRows"|"deleteRows"|"insertCols"|"deleteCols", sheet, at, count}`
    /// or `{op: "addSheet", name, index}` / `{op: "deleteSheet", sheet}` / `{op: "renameSheet", sheet, name}`.
    pub fn structural(&mut self, op: &str) -> Result<(), JsError> {
        let op: Structural = serde_json::from_str(op).map_err(js_err)?;
        self.calc.structural(&op).map_err(js_err)
    }

    /// Recalculate. Returns the formula cells whose result changed:
    /// JSON `[[sheet, {r, c, t, v, text}], …]`.
    pub fn evaluate(&mut self) -> Result<String, JsError> {
        to_json(&self.calc.evaluate())
    }

    /// Computed cells in a rectangle (0-based, inclusive): JSON `[{r, c, t, v, text}, …]`.
    pub fn values(&self, sheet: usize, r0: u32, c0: u32, r1: u32, c1: u32) -> Result<String, JsError> {
        to_json(&self.calc.values(sheet, r0, c0, r1, c1))
    }

    /// Completion context for a formula being typed (`=SU|`).
    pub fn completion(&mut self, sheet: usize, r: u32, c: u32, formula: &str, cursor: usize) -> Result<String, JsError> {
        to_json(&self.calc.completion(sheet, r, c, formula, cursor).map_err(js_err)?)
    }
}
