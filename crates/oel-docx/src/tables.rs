//! What a table looks like in Word: borders, shading, run formatting and cell
//! margins resolved from the table style chain, its conditional formats
//! (`firstRow`, `band1Horz`… gated by `w:tblLook`), the table's own
//! properties, row exceptions and each cell's own properties. The result is
//! display-only CSS for the editor; export writes the raw XML back untouched.

use super::styles::{Styles, border_css, set};
use super::xml::XElement;
use std::collections::HashMap;

const SIDES: [&str; 4] = ["top", "left", "bottom", "right"];

/// Which conditional formats a table enables (`w:tblLook`).
#[derive(Debug, Clone, Copy)]
struct Look {
    first_row: bool,
    last_row: bool,
    first_col: bool,
    last_col: bool,
    h_band: bool,
    v_band: bool,
}

impl Look {
    fn of(tblpr: Option<&XElement>) -> Look {
        let l = tblpr.and_then(|p| p.child("w:tblLook"));
        let hex = l.and_then(|l| l.attr("w:val")).and_then(|v| u32::from_str_radix(v, 16).ok());
        let flag = |name: &str, bit: u32, default: bool| -> bool {
            match l.and_then(|l| l.attr(name)) {
                Some(v) => matches!(v, "1" | "true" | "on"),
                None => hex.map(|h| h & bit != 0).unwrap_or(default),
            }
        };
        // Word's defaults when tblLook is absent: first row, first column and row banding.
        Look {
            first_row: flag("w:firstRow", 0x0020, true),
            last_row: flag("w:lastRow", 0x0040, false),
            first_col: flag("w:firstColumn", 0x0080, true),
            last_col: flag("w:lastColumn", 0x0100, false),
            h_band: !flag("w:noHBand", 0x0200, false),
            v_band: !flag("w:noVBand", 0x0400, true),
        }
    }
}

/// Merged properties of one layer (a style, a condition, the table, a cell).
#[derive(Debug, Clone, Default)]
struct Layer {
    /// top/left/bottom/right/insideH/insideV → border element (cloned).
    borders: HashMap<String, XElement>,
    shd: Option<String>,
    margins: HashMap<String, i64>,
}

fn side_key(local: &str) -> &str {
    match local {
        "start" => "left",
        "end" => "right",
        other => other,
    }
}

impl Layer {
    fn add_borders(&mut self, borders: Option<&XElement>) {
        for b in borders.into_iter().flat_map(|b| b.elements()) {
            self.borders.insert(side_key(b.local()).to_string(), b.clone());
        }
    }

    fn add_shd(&mut self, shd: Option<&XElement>) {
        if let Some(f) = shd.and_then(|s| s.attr("w:fill")).filter(|f| f.len() == 6) {
            self.shd = Some(format!("#{}", f.to_ascii_uppercase()));
        } else if shd.and_then(|s| s.attr("w:val")) == Some("nil") {
            self.shd = None;
        }
    }

    fn add_margins(&mut self, mar: Option<&XElement>) {
        for m in mar.into_iter().flat_map(|m| m.elements()) {
            if m.attr("w:type").is_some_and(|t| t != "dxa") {
                continue;
            }
            if let Some(w) = m.attr("w:w").and_then(|v| v.parse::<i64>().ok()) {
                self.margins.insert(side_key(m.local()).to_string(), w);
            }
        }
    }

    fn add_tblpr(&mut self, tblpr: Option<&XElement>) {
        let Some(p) = tblpr else { return };
        self.add_borders(p.child("w:tblBorders"));
        self.add_shd(p.child("w:shd"));
        self.add_margins(p.child("w:tblCellMar"));
    }

    fn add_tcpr(&mut self, tcpr: Option<&XElement>) {
        let Some(p) = tcpr else { return };
        self.add_borders(p.child("w:tcBorders"));
        self.add_shd(p.child("w:shd"));
        self.add_margins(p.child("w:tcMar"));
    }
}

/// A table being read: its style layers, ready to resolve cells.
pub struct TableLook<'s> {
    styles: &'s Styles,
    style_id: Option<String>,
    look: Look,
    /// Table-wide borders/shading/margins: style chain, then the table's own tblPr.
    table: Layer,
    row_band: usize,
    col_band: usize,
}

/// A cell's place in its table.
pub struct CellPos {
    pub row: usize,
    pub row_span: usize,
    pub rows: usize,
    pub col: usize,
    pub span: usize,
    pub cols: usize,
}

impl<'s> TableLook<'s> {
    pub fn new(styles: &'s Styles, tblpr: Option<&XElement>) -> TableLook<'s> {
        let style_id = tblpr
            .and_then(|p| p.child_val("w:tblStyle"))
            .map(String::from)
            .or_else(|| styles.default_table_style().map(|d| d.id.clone()));
        let mut table = Layer::default();
        let mut row_band = 1;
        let mut col_band = 1;
        if let Some(id) = &style_id {
            for s in styles.chain(id) {
                table.add_tblpr(s.tblpr.as_ref());
                table.add_tcpr(s.tcpr.as_ref());
                let band = |k: &str| s.tblpr.as_ref().and_then(|p| p.child_val(k)).and_then(|v| v.parse::<usize>().ok());
                row_band = band("w:tblStyleRowBandSize").unwrap_or(row_band);
                col_band = band("w:tblStyleColBandSize").unwrap_or(col_band);
            }
        }
        table.add_tblpr(tblpr);
        TableLook { styles, style_id, look: Look::of(tblpr), table, row_band: row_band.max(1), col_band: col_band.max(1) }
    }

    /// The table style id in effect (named, or the document's default table style).
    pub fn style_id(&self) -> Option<&str> {
        self.style_id.as_deref()
    }

    /// Conditional formats that apply to a cell, lowest priority first.
    fn conditions(&self, c: &CellPos) -> Vec<&'static str> {
        let l = self.look;
        let first_row = l.first_row && c.row == 0;
        let last_row = l.last_row && c.row + c.row_span >= c.rows;
        let first_col = l.first_col && c.col == 0;
        let last_col = l.last_col && c.col + c.span == c.cols;
        let mut out = vec!["wholeTable"];
        if l.v_band && !first_col && !last_col {
            let i = c.col - usize::from(l.first_col);
            out.push(if (i / self.col_band).is_multiple_of(2) { "band1Vert" } else { "band2Vert" });
        }
        if l.h_band && !first_row && !last_row {
            let i = c.row - usize::from(l.first_row);
            out.push(if (i / self.row_band).is_multiple_of(2) { "band1Horz" } else { "band2Horz" });
        }
        if first_col {
            out.push("firstCol");
        }
        if last_col {
            out.push("lastCol");
        }
        if first_row {
            out.push("firstRow");
        }
        if last_row {
            out.push("lastRow");
        }
        match (first_row, last_row, first_col, last_col) {
            (true, _, true, _) => out.push("nwCell"),
            (true, _, _, true) => out.push("neCell"),
            (_, true, true, _) => out.push("swCell"),
            (_, true, _, true) => out.push("seCell"),
            _ => {}
        }
        out
    }

    /// Display-only CSS of a cell (borders, conditional shading and text, margins).
    /// `direct_shd`: the cell has its own shading (rendered from its `background` attr).
    pub fn cell_css(&self, c: &CellPos, tbl_pr_ex: Option<&XElement>, tcpr: Option<&XElement>, direct_shd: bool) -> Option<String> {
        let mut layer = self.table.clone();
        // Row exceptions override the table's own borders.
        if let Some(ex) = tbl_pr_ex {
            layer.add_borders(ex.child("w:tblBorders"));
            layer.add_margins(ex.child("w:tblCellMar"));
        }
        let mut edge: HashMap<&str, Option<XElement>> = HashMap::new();
        let pick = |l: &Layer, side: &str, outer: bool| -> Option<Option<XElement>> {
            let inner = if side == "top" || side == "bottom" { "insideH" } else { "insideV" };
            if outer { l.borders.get(side).cloned().map(Some) } else { l.borders.get(inner).cloned().map(Some) }
        };
        let outer = |side: &str| match side {
            "top" => c.row == 0,
            "bottom" => c.row + c.row_span >= c.rows,
            "left" => c.col == 0,
            _ => c.col + c.span >= c.cols,
        };
        for side in SIDES {
            edge.insert(side, pick(&layer, side, outer(side)).flatten());
        }
        // Conditional formats from the style chain, in priority order.
        let mut rpr: Vec<XElement> = Vec::new();
        let mut shd: Option<String> = layer.shd.clone();
        if let Some(id) = &self.style_id {
            let chain = self.styles.chain(id);
            for cond in self.conditions(c) {
                for s in &chain {
                    for (_, e) in s.cond.iter().filter(|(t, _)| t == cond) {
                        let mut l = Layer::default();
                        l.add_tblpr(e.child("w:tblPr"));
                        l.add_tcpr(e.child("w:tcPr"));
                        for side in SIDES {
                            // In a conditional format, its own edges are outer; insideH/V separate its cells.
                            if let Some(b) = l.borders.get(side).cloned().or_else(|| pick(&l, side, false).flatten()) {
                                edge.insert(side, Some(b));
                            }
                        }
                        if l.shd.is_some() {
                            shd = l.shd;
                        }
                        layer.margins.extend(l.margins);
                        if let Some(r) = e.child("w:rPr") {
                            rpr.push(r.clone());
                        }
                    }
                }
            }
        }
        // The cell's own properties win.
        let mut own = Layer::default();
        own.add_tcpr(tcpr);
        for (side, b) in &own.borders {
            if let Some(slot) = edge.get_mut(side.as_str()) {
                *slot = Some(b.clone());
            }
        }
        layer.margins.extend(own.margins);

        let mut decls: Vec<(String, String)> = Vec::new();
        for side in SIDES {
            if let Some(css) = edge.get(side).cloned().flatten().as_ref().and_then(border_css) {
                set(&mut decls, &format!("border-{side}"), css);
            }
        }
        if !direct_shd {
            if let Some(bg) = shd {
                set(&mut decls, "background-color", bg);
            }
        }
        for r in &rpr {
            self.styles.rpr_decls(r, &mut decls);
        }
        for side in SIDES {
            if let Some(w) = layer.margins.get(side) {
                set(&mut decls, &format!("padding-{side}"), format!("{}pt", *w as f64 / 20.0));
            }
        }
        if decls.is_empty() {
            return None;
        }
        Some(decls.iter().map(|(k, v)| format!("{k}:{v}")).collect::<Vec<_>>().join(";"))
    }
}

/// Display-only CSS of a table: width, alignment, indent.
pub fn table_css(styles: &Styles, tblpr: Option<&XElement>, style_id: Option<&str>) -> Option<String> {
    // Style values first, the table's own last.
    let mut layers: Vec<&XElement> = style_id.into_iter().flat_map(|id| styles.chain(id)).filter_map(|s| s.tblpr.as_ref()).collect();
    if let Some(p) = tblpr {
        layers.push(p);
    }
    let mut decls: Vec<(String, String)> = Vec::new();
    for p in layers {
        if let Some(w) = p.child("w:tblW") {
            let v = w.attr("w:w").unwrap_or("0");
            match w.attr("w:type").unwrap_or("dxa") {
                "pct" => {
                    let pct = if let Some(p) = v.strip_suffix('%') { p.parse::<f64>().ok() } else { v.parse::<f64>().ok().map(|f| f / 50.0) };
                    if let Some(pct) = pct.filter(|p| *p > 0.0) {
                        set(&mut decls, "width", format!("{pct}%"));
                    }
                }
                "dxa" => {
                    if let Some(tw) = v.parse::<f64>().ok().filter(|t| *t > 0.0) {
                        set(&mut decls, "width", format!("{}pt", tw / 20.0));
                    }
                }
                _ => {}
            }
        }
        match p.child_val("w:jc") {
            Some("center") => {
                set(&mut decls, "margin-left", "auto".into());
                set(&mut decls, "margin-right", "auto".into());
            }
            Some("right" | "end") => set(&mut decls, "margin-left", "auto".into()),
            _ => {}
        }
        if let Some(ind) = p.child("w:tblInd").filter(|i| i.attr("w:type").is_none_or(|t| t == "dxa")).and_then(|i| i.attr("w:w")).and_then(|v| v.parse::<f64>().ok()) {
            if !decls.iter().any(|(k, v)| k == "margin-left" && v == "auto") {
                set(&mut decls, "margin-left", format!("{}pt", ind / 20.0));
            }
        }
    }
    if decls.is_empty() {
        return None;
    }
    Some(decls.iter().map(|(k, v)| format!("{k}:{v}")).collect::<Vec<_>>().join(";"))
}
