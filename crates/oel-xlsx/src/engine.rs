//! The calc engine: an IronCalc [`Model`] fed from the editor's inputs.
//!
//! This is the only module that touches IronCalc types. The editor (Y.Doc)
//! owns the inputs and styles; the engine is rebuilt from them and kept in
//! step with small diffs, and answers with computed values and their text
//! formatted by the cell's number format, the way Excel shows it.

use crate::model::{Cell, Workbook};
use crate::refs::{a1, parse_range};
use ironcalc_base::cell::CellValue;
use ironcalc_base::expressions::types::Area;
use ironcalc_base::types::{CellType, Style};
use ironcalc_base::Model;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// One cell input change from the editor (0-based row and column).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/", optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct CellInput {
    pub sheet: usize,
    pub r: u32,
    pub c: u32,
    /// Formula without `=`.
    #[serde(default)]
    pub f: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<crate::model::CellType>"))]
    pub t: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(as = "Option<crate::model::CellValue>"))]
    pub v: Option<serde_json::Value>,
    #[serde(default)]
    pub a: Option<String>,
    /// Number-format code of the cell's style (`General` when absent).
    #[serde(default)]
    pub fmt: Option<String>,
}

/// A computed cell for the grid.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/"))]
#[serde(rename_all = "camelCase")]
pub struct CellOut {
    pub r: u32,
    pub c: u32,
    /// `n`, `s`, `b`, `e`.
    #[cfg_attr(feature = "ts", ts(as = "crate::model::CellType"))]
    pub t: &'static str,
    #[cfg_attr(feature = "ts", ts(as = "Option<crate::model::CellValue>"))]
    pub v: serde_json::Value,
    /// Text as displayed with the number format.
    pub text: String,
}

/// Structural edits, applied the same way on every client.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelxlsx/"))]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Structural {
    InsertRows { sheet: usize, at: u32, count: u32 },
    DeleteRows { sheet: usize, at: u32, count: u32 },
    InsertCols { sheet: usize, at: u32, count: u32 },
    DeleteCols { sheet: usize, at: u32, count: u32 },
    AddSheet { name: String, index: usize },
    DeleteSheet { sheet: usize },
    RenameSheet { sheet: usize, name: String },
}

pub struct Calc {
    model: Model<'static>,
    /// Cells whose number format we set, so clearing it is cheap to detect.
    formatted: HashSet<(usize, u32, u32)>,
    /// Last values seen for formula cells, to report what changed.
    last: HashMap<(usize, u32, u32), (String, String)>,
}

fn json_num(n: f64) -> serde_json::Value {
    serde_json::Number::from_f64(n).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
}

/// IronCalc rejects some names Excel allows; keep it working with a safe stand-in.
fn engine_sheet_name(name: &str, index: usize) -> String {
    let bad = name.is_empty() || name.len() > 31 || name.contains(['[', ']', '*', '?', ':', '/', '\\']) || name.starts_with('\'') || name.ends_with('\'');
    if bad { format!("Sheet{}", index + 1) } else { name.to_string() }
}

impl Calc {
    pub fn new(wb: &Workbook) -> Result<Calc, String> {
        let mut model = Model::new_empty("oel", "en", "UTC", "en")?;
        for (i, s) in wb.sheets.iter().enumerate() {
            let name = engine_sheet_name(&s.name, i);
            if i == 0 {
                model.rename_sheet_by_index(0, &name)?;
            } else {
                model.add_sheet(&name).or_else(|_| model.add_sheet(&format!("Sheet{}", i + 1)))?;
            }
        }
        if wb.sheets.is_empty() {
            return Err("aucune feuille".into());
        }
        let mut calc = Calc { model, formatted: HashSet::new(), last: HashMap::new() };
        for n in &wb.names {
            let scope = n.scope.as_ref().and_then(|id| wb.sheets.iter().position(|s| &s.id == id)).map(|i| i as u32);
            // Names Excel writes for its own use (_xlnm.Print_Area…) are not needed to compute.
            if n.name.starts_with("_xlnm.") {
                continue;
            }
            let _ = calc.model.new_defined_name(&n.name, scope, &n.formula);
        }
        let fmt_of = |s: u32| wb.styles.get(s as usize).map(|st| st.num_fmt.clone()).unwrap_or_else(crate::model::general);
        for (si, sheet) in wb.sheets.iter().enumerate() {
            for cell in &sheet.cells {
                let input = input_of(si, cell, fmt_of(cell.s));
                // A bad formula from a file must not stop the load; it shows as an error cell.
                let _ = calc.set(&input);
            }
        }
        calc.model.evaluate();
        calc.snapshot();
        Ok(calc)
    }

    fn set(&mut self, i: &CellInput) -> Result<(), String> {
        let (sheet, row, col) = (i.sheet as u32, i.r as i32 + 1, i.c as i32 + 1);
        // Number format first: IronCalc keeps a cell's style when its value changes.
        let fmt = i.fmt.as_deref().unwrap_or("General");
        let key = (i.sheet, i.r, i.c);
        if fmt != "General" || self.formatted.contains(&key) {
            let style = Style { num_fmt: fmt.to_string(), ..Default::default() };
            self.model.set_cell_style(sheet, row, col, &style)?;
            if fmt == "General" {
                self.formatted.remove(&key);
            } else {
                self.formatted.insert(key);
            }
        }
        if let Some(f) = &i.f {
            if let Some(rng) = i.a.as_deref().and_then(parse_range) {
                let (w, h) = ((rng.c1 - rng.c0 + 1) as i32, (rng.r1 - rng.r0 + 1) as i32);
                return self.model.set_user_array_formula(sheet, row, col, w, h, &format!("={f}"));
            }
            return self.model.update_cell_with_formula(sheet, row, col, format!("={f}")).or_else(|_| {
                // Not parseable: keep what the person typed, as text (Excel would refuse it).
                self.model.update_cell_with_text(sheet, row, col, &format!("={f}"))
            });
        }
        self.last.remove(&key);
        match (i.t.as_deref(), &i.v) {
            (Some("n"), Some(v)) => self.model.update_cell_with_number(sheet, row, col, v.as_f64().unwrap_or(0.0)),
            (Some("b"), Some(v)) => self.model.update_cell_with_bool(sheet, row, col, v.as_bool().unwrap_or(false)),
            (Some("e"), Some(v)) => self.model.set_user_input(sheet, row, col, v.as_str().unwrap_or("#N/A").to_string()),
            (Some(_), Some(serde_json::Value::String(s))) => self.model.update_cell_with_text(sheet, row, col, s),
            (Some(_), Some(v)) => self.model.update_cell_with_text(sheet, row, col, &v.to_string()),
            _ => self.model.range_clear_contents(&Area { sheet, row, column: col, width: 1, height: 1 }),
        }
    }

    /// Apply input changes (no evaluation).
    pub fn apply(&mut self, inputs: &[CellInput]) -> Vec<String> {
        inputs.iter().filter_map(|i| self.set(i).err().map(|e| format!("{}: {e}", a1(i.r, i.c)))).collect()
    }

    pub fn structural(&mut self, op: &Structural) -> Result<(), String> {
        let m = &mut self.model;
        match op {
            Structural::InsertRows { sheet, at, count } => m.insert_rows(*sheet as u32, *at as i32 + 1, *count as i32),
            Structural::DeleteRows { sheet, at, count } => m.delete_rows(*sheet as u32, *at as i32 + 1, *count as i32),
            Structural::InsertCols { sheet, at, count } => m.insert_columns(*sheet as u32, *at as i32 + 1, *count as i32),
            Structural::DeleteCols { sheet, at, count } => m.delete_columns(*sheet as u32, *at as i32 + 1, *count as i32),
            Structural::AddSheet { name, index } => m.insert_sheet(&engine_sheet_name(name, *index), *index as u32, None),
            Structural::DeleteSheet { sheet } => m.delete_sheet(*sheet as u32),
            Structural::RenameSheet { sheet, name } => m.rename_sheet_by_index(*sheet as u32, &engine_sheet_name(name, *sheet)),
        }?;
        // Positions moved: the change report starts over.
        self.formatted.clear();
        self.last.clear();
        self.snapshot();
        Ok(())
    }

    /// Recalculate and return the formula cells whose result changed.
    pub fn evaluate(&mut self) -> Vec<(usize, CellOut)> {
        self.model.evaluate();
        let mut changed = Vec::new();
        for (si, ws) in self.model.workbook.worksheets.iter().enumerate() {
            for (row, cols) in &ws.sheet_data {
                for (col, cell) in cols {
                    if cell.get_formula().is_none() {
                        continue;
                    }
                    let (r, c) = ((*row - 1) as u32, (*col - 1) as u32);
                    if let Some(out) = self.cell_out(si, r, c) {
                        let sig = (out.text.clone(), out.v.to_string());
                        if self.last.get(&(si, r, c)) != Some(&sig) {
                            self.last.insert((si, r, c), sig);
                            changed.push((si, out));
                        }
                    }
                }
            }
        }
        changed
    }

    fn snapshot(&mut self) {
        let _ = self.evaluate();
    }

    pub fn cell_out(&self, sheet: usize, r: u32, c: u32) -> Option<CellOut> {
        let (s, row, col) = (sheet as u32, r as i32 + 1, c as i32 + 1);
        let ws = self.model.workbook.worksheets.get(sheet)?;
        ws.sheet_data.get(&row)?.get(&col)?;
        let kind = self.model.get_cell_type(s, row, col).ok()?;
        let text = self.model.get_formatted_cell_value(s, row, col).ok()?;
        let value = self.model.get_cell_value_by_index(s, row, col).ok()?;
        let (t, v) = match (kind, value) {
            (_, CellValue::None) => return None,
            (CellType::ErrorValue, CellValue::String(e)) => ("e", serde_json::Value::String(e)),
            (_, CellValue::Number(n)) => ("n", json_num(n)),
            (_, CellValue::Boolean(b)) => ("b", serde_json::Value::Bool(b)),
            (_, CellValue::String(s)) => ("s", serde_json::Value::String(s)),
        };
        Some(CellOut { r, c, t, v, text })
    }

    /// Every non-empty computed cell in a rectangle (0-based, inclusive).
    pub fn values(&self, sheet: usize, r0: u32, c0: u32, r1: u32, c1: u32) -> Vec<CellOut> {
        let Some(ws) = self.model.workbook.worksheets.get(sheet) else { return Vec::new() };
        let mut out = Vec::new();
        for (row, cols) in &ws.sheet_data {
            let r = (*row - 1) as u32;
            if r < r0 || r > r1 {
                continue;
            }
            for col in cols.keys() {
                let c = (*col - 1) as u32;
                if c >= c0 && c <= c1 {
                    if let Some(o) = self.cell_out(sheet, r, c) {
                        out.push(o);
                    }
                }
            }
        }
        out.sort_by_key(|o| (o.r, o.c));
        out
    }

    /// Completion context for the formula being typed (function names, references…).
    pub fn completion(&mut self, sheet: usize, r: u32, c: u32, formula: &str, cursor: usize) -> Result<serde_json::Value, String> {
        let ctx = self.model.formula_completion(sheet as u32, r as i32 + 1, c as i32 + 1, formula, cursor)?;
        serde_json::to_value(ctx).map_err(|e| e.to_string())
    }

    /// Fill formula cells' cached values (`t`/`v`) in a workbook, for export.
    pub fn fill_cached(&mut self, wb: &mut Workbook) {
        for (si, sheet) in wb.sheets.iter_mut().enumerate() {
            for cell in sheet.cells.iter_mut().filter(|c| c.f.is_some()) {
                match self.cell_out(si, cell.r, cell.c) {
                    Some(o) => {
                        cell.t = Some(o.t.to_string());
                        cell.v = Some(o.v);
                    }
                    None => {
                        cell.t = None;
                        cell.v = None;
                    }
                }
            }
        }
    }

    /// Format a number with an Excel format code (for the format picker preview).
    pub fn format_number(value: f64, code: &str) -> String {
        ironcalc_base::number_format::format_number(value, code, "en").text
    }
}

fn input_of(sheet: usize, cell: &Cell, fmt: String) -> CellInput {
    CellInput { sheet, r: cell.r, c: cell.c, f: cell.f.clone(), t: cell.t.clone(), v: cell.v.clone(), a: cell.a.clone(), fmt: Some(fmt) }
}

/// Compute every formula of a workbook once and store the results as cached values.
pub fn recalc(wb: &mut Workbook) -> Result<(), String> {
    let mut calc = Calc::new(wb)?;
    calc.fill_cached(wb);
    Ok(())
}
