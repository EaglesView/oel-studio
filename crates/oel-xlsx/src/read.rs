//! `.xlsx` → [`Workbook`] JSON.

use crate::model::*;
use crate::refs::{parse_a1, parse_range, shift_formula, strip_future_prefixes};
use crate::styles::{read_color, read_styles, theme_colors};
use oel_opc::package::{Package, resolve_target};
use oel_opc::xml::{XDocument, XElement};
use std::collections::HashMap;

pub const REL_WORKSHEET: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
pub const REL_SHARED_STRINGS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";
pub const REL_STYLES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
pub const REL_THEME: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
pub const REL_CALC_CHAIN: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain";
pub const REL_COMMENTS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
pub const REL_TABLE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";

/// A shared string: plain text, and the raw `<si>` content when it has runs.
pub struct SharedString {
    pub text: String,
    pub rich: Option<String>,
}

pub fn workbook_part(pkg: &Package) -> String {
    pkg.office_document().unwrap_or_else(|| "xl/workbook.xml".to_string())
}

/// The part a workbook relationship of this type points to.
pub fn workbook_rel_target(pkg: &Package, wb_part: &str, rel_type: &str) -> Option<String> {
    pkg.rels(wb_part).into_iter().find(|r| r.rel_type == rel_type).map(|r| resolve_target(wb_part, &r.target))
}

/// An attribute in the relationships namespace (`r:id`, whatever the prefix).
pub fn rel_id_attr(e: &XElement) -> Option<&str> {
    e.attrs.iter().find(|(k, _)| k.ends_with(":id") && !k.starts_with("xr")).map(|(_, v)| v.as_str())
}

fn read_shared_strings(doc: Option<&XDocument>) -> Vec<SharedString> {
    let Some(doc) = doc else { return Vec::new() };
    doc.root
        .children_local("si")
        .map(|si| {
            let has_runs = si.children_local("r").next().is_some();
            // Phonetic runs (rPh) are not part of the text.
            let text: String = if has_runs {
                si.children_local("r").filter_map(|r| r.child_local("t")).map(|t| t.text_content()).collect()
            } else {
                si.child_local("t").map(|t| t.text_content()).unwrap_or_default()
            };
            let rich = has_runs.then(|| oel_opc::xml::nodes_to_xml(&si.children));
            SharedString { text, rich }
        })
        .collect()
}

fn attr_bool(e: &XElement, name: &str) -> bool {
    matches!(e.attr(name), Some("1") | Some("true"))
}

fn attr_f64(e: &XElement, name: &str) -> Option<f64> {
    e.attr(name).and_then(|v| v.parse().ok())
}

fn parse_number(s: &str) -> serde_json::Value {
    match s.trim().parse::<f64>() {
        Ok(n) if n.is_finite() => serde_json::Number::from_f64(n).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null),
        _ => serde_json::Value::String(s.to_string()),
    }
}

struct SheetCtx<'a> {
    pkg: &'a Package,
    part: String,
    strings: &'a [SharedString],
    theme: &'a [String],
}

fn read_cells(ctx: &SheetCtx, sheet_data: &XElement, sheet: &mut Sheet) {
    // Shared formulas: si → (anchor row, anchor col, formula).
    let mut shared: HashMap<String, (u32, u32, String)> = HashMap::new();
    let mut next_row: u32 = 0;
    for row in sheet_data.children_local("row") {
        let r = row.attr("r").and_then(|v| v.parse::<u32>().ok()).map(|v| v - 1).unwrap_or(next_row);
        next_row = r + 1;
        let height = attr_f64(row, "ht");
        let custom = attr_bool(row, "customHeight");
        let hidden = attr_bool(row, "hidden");
        let style = attr_bool(row, "customFormat").then(|| row.attr("s").and_then(|v| v.parse().ok())).flatten();
        let outline = row.attr("outlineLevel").and_then(|v| v.parse().ok()).unwrap_or(0);
        let height = height.filter(|h| custom || (*h - sheet.default_row_height).abs() > 0.01);
        if height.is_some() || hidden || style.is_some() || outline > 0 {
            sheet.rows.push(RowInfo { r, height, hidden, style, outline });
        }
        let mut next_col: u32 = 0;
        for c in row.children_local("c") {
            let (r, col) = c.attr("r").and_then(parse_a1).unwrap_or((r, next_col));
            next_col = col + 1;
            let s = c.attr("s").and_then(|v| v.parse().ok()).unwrap_or(0);
            let mut cell = Cell { r, c: col, s, ..Default::default() };
            let v = c.child_local("v").map(|v| v.text_content());
            match c.attr("t").unwrap_or("n") {
                "s" => {
                    if let Some(ss) = v.as_deref().and_then(|i| i.trim().parse::<usize>().ok()).and_then(|i| ctx.strings.get(i)) {
                        cell.t = Some("s".into());
                        cell.v = Some(serde_json::Value::String(ss.text.clone()));
                        cell.rich = ss.rich.clone();
                    }
                }
                "inlineStr" => {
                    let text = c
                        .child_local("is")
                        .map(|is| {
                            if is.child_local("r").is_some() {
                                is.children_local("r").filter_map(|r| r.child_local("t")).map(|t| t.text_content()).collect()
                            } else {
                                is.child_local("t").map(|t| t.text_content()).unwrap_or_default()
                            }
                        })
                        .unwrap_or_default();
                    cell.t = Some("s".into());
                    cell.v = Some(serde_json::Value::String(text));
                }
                "str" => {
                    if let Some(v) = v {
                        cell.t = Some("s".into());
                        cell.v = Some(serde_json::Value::String(v));
                    }
                }
                "b" => {
                    if let Some(v) = v {
                        cell.t = Some("b".into());
                        cell.v = Some(serde_json::Value::Bool(v.trim() == "1" || v.trim() == "true"));
                    }
                }
                "e" => {
                    if let Some(v) = v {
                        cell.t = Some("e".into());
                        cell.v = Some(serde_json::Value::String(v));
                    }
                }
                "d" => {
                    if let Some(v) = v {
                        cell.t = Some("s".into());
                        cell.v = Some(serde_json::Value::String(v));
                    }
                }
                _ => {
                    if let Some(v) = v.filter(|v| !v.trim().is_empty()) {
                        cell.t = Some("n".into());
                        cell.v = Some(parse_number(&v));
                    }
                }
            }
            if let Some(f) = c.child_local("f") {
                let text = f.text_content();
                match f.attr("t") {
                    Some("shared") => {
                        let si = f.attr("si").unwrap_or("").to_string();
                        if !text.trim().is_empty() {
                            shared.insert(si, (r, col, text.clone()));
                            cell.f = Some(text);
                        } else if let Some((ar, ac, base)) = shared.get(&si) {
                            cell.f = Some(shift_formula(base, r as i64 - *ar as i64, col as i64 - *ac as i64));
                        }
                    }
                    Some("array") => {
                        cell.f = Some(text);
                        cell.a = f.attr("ref").map(String::from);
                    }
                    // Data tables (t="dataTable") keep their cached values only.
                    Some("dataTable") => {}
                    _ => {
                        if !text.trim().is_empty() {
                            cell.f = Some(text);
                        }
                    }
                }
                if let Some(f) = cell.f.take() {
                    cell.f = Some(strip_future_prefixes(f.trim_start_matches('=')));
                }
            }
            if cell.t.is_some() || cell.f.is_some() || cell.s != 0 {
                sheet.cells.push(cell);
            }
        }
    }
}

fn read_cond_formats(ws: &XElement, theme: &[String]) -> Vec<CondFormat> {
    ws.children_local("conditionalFormatting")
        .map(|cf| CondFormat {
            sqref: cf.attr("sqref").unwrap_or_default().to_string(),
            rules: cf
                .children_local("cfRule")
                .map(|rule| {
                    let scale = rule.child_local("colorScale").or_else(|| rule.child_local("dataBar"));
                    CondRule {
                        kind: rule.attr("type").unwrap_or_default().to_string(),
                        operator: rule.attr("operator").map(String::from),
                        formulas: rule.children_local("formula").map(|f| f.text_content()).collect(),
                        dxf: rule.attr("dxfId").and_then(|v| v.parse().ok()),
                        priority: rule.attr("priority").and_then(|v| v.parse().ok()).unwrap_or(0),
                        stop: attr_bool(rule, "stopIfTrue"),
                        colors: scale.map(|s| s.children_local("color").filter_map(|c| read_color(c, theme)).collect()).unwrap_or_default(),
                        raw: Some(rule.to_xml()),
                    }
                })
                .collect(),
        })
        .collect()
}

fn read_validations(ws: &XElement) -> Vec<Validation> {
    let Some(dvs) = ws.child_local("dataValidations") else { return Vec::new() };
    dvs.children_local("dataValidation")
        .map(|dv| Validation {
            sqref: dv.attr("sqref").unwrap_or_default().to_string(),
            kind: dv.attr("type").unwrap_or("none").to_string(),
            operator: dv.attr("operator").map(String::from),
            formula1: dv.child_local("formula1").map(|f| f.text_content()),
            formula2: dv.child_local("formula2").map(|f| f.text_content()),
            allow_blank: attr_bool(dv, "allowBlank"),
            error: dv.attr("error").map(String::from),
            prompt: dv.attr("prompt").map(String::from),
            raw: Some(dv.to_xml()),
        })
        .collect()
}

fn read_hyperlinks(ctx: &SheetCtx, ws: &XElement) -> Vec<Hyperlink> {
    let Some(hl) = ws.child_local("hyperlinks") else { return Vec::new() };
    let rels = ctx.pkg.rels(&ctx.part);
    hl.children_local("hyperlink")
        .map(|h| Hyperlink {
            range: h.attr("ref").unwrap_or_default().to_string(),
            target: rel_id_attr(h).and_then(|id| rels.iter().find(|r| r.id == id)).map(|r| r.target.clone()),
            location: h.attr("location").map(String::from),
            tooltip: h.attr("tooltip").map(String::from),
            display: h.attr("display").map(String::from),
        })
        .collect()
}

fn read_notes(ctx: &SheetCtx) -> Vec<Note> {
    let Some(rel) = ctx.pkg.rels(&ctx.part).into_iter().find(|r| r.rel_type == REL_COMMENTS) else { return Vec::new() };
    let Some(doc) = ctx.pkg.get_xml(&resolve_target(&ctx.part, &rel.target)) else { return Vec::new() };
    let authors: Vec<String> = doc.root.child_local("authors").map(|a| a.children_local("author").map(|x| x.text_content()).collect()).unwrap_or_default();
    doc.root
        .child_local("commentList")
        .map(|l| {
            l.children_local("comment")
                .filter_map(|c| {
                    let (r, col) = parse_a1(c.attr("ref")?)?;
                    let author = c.attr("authorId").and_then(|i| i.parse::<usize>().ok()).and_then(|i| authors.get(i)).cloned().unwrap_or_default();
                    let text = c.child_local("text").map(|t| t.text_content()).unwrap_or_default();
                    Some(Note { r, c: col, author, text })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn read_tables(ctx: &SheetCtx) -> Vec<Table> {
    ctx.pkg
        .rels(&ctx.part)
        .into_iter()
        .filter(|r| r.rel_type == REL_TABLE)
        .filter_map(|rel| {
            let part = resolve_target(&ctx.part, &rel.target);
            let doc = ctx.pkg.get_xml(&part)?;
            let t = &doc.root;
            let range = t.attr("ref").filter(|r| parse_range(r).is_some())?.to_string();
            Some(Table {
                name: t.attr("displayName").or(t.attr("name"))?.to_string(),
                part,
                range,
                header_rows: t.attr("headerRowCount").and_then(|v| v.parse().ok()).unwrap_or(1),
                totals_rows: t.attr("totalsRowCount").and_then(|v| v.parse().ok()).unwrap_or(0),
                columns: t.child_local("tableColumns").map(|c| c.children_local("tableColumn").map(|c| c.attr("name").unwrap_or_default().to_string()).collect()).unwrap_or_default(),
                style: t.child_local("tableStyleInfo").and_then(|s| s.attr("name")).map(String::from),
            })
        })
        .collect()
}

fn read_sheet(ctx: &SheetCtx, name: &str, state: SheetState) -> Result<Sheet, String> {
    let doc = ctx.pkg.get_xml(&ctx.part).ok_or_else(|| format!("feuille introuvable : {}", ctx.part))?;
    let ws = &doc.root;
    let mut sheet = Sheet { id: ctx.part.clone(), name: name.to_string(), state, zoom: 100, show_grid: true, ..Default::default() };
    sheet.default_col_width = crate::model::default_col_width();
    sheet.default_row_height = crate::model::default_row_height();
    if let Some(fp) = ws.child_local("sheetFormatPr") {
        if let Some(h) = attr_f64(fp, "defaultRowHeight") {
            sheet.default_row_height = h;
        }
        if let Some(w) = attr_f64(fp, "defaultColWidth") {
            sheet.default_col_width = w;
        } else if let Some(b) = attr_f64(fp, "baseColWidth") {
            // Excel: default width = baseColWidth + padding (≈ 0.71 char for Calibri 11).
            sheet.default_col_width = b + 0.43;
        }
    }
    if let Some(pr) = ws.child_local("sheetPr") {
        sheet.tab_color = pr.child_local("tabColor").and_then(|c| read_color(c, ctx.theme));
    }
    if let Some(view) = ws.child_local("sheetViews").and_then(|v| v.child_local("sheetView")) {
        sheet.show_grid = !matches!(view.attr("showGridLines"), Some("0") | Some("false"));
        sheet.zoom = view.attr("zoomScale").and_then(|z| z.parse().ok()).unwrap_or(100);
        if let Some(p) = view.child_local("pane") {
            if matches!(p.attr("state"), Some("frozen") | Some("frozenSplit")) {
                sheet.frozen_cols = attr_f64(p, "xSplit").unwrap_or(0.0) as u32;
                sheet.frozen_rows = attr_f64(p, "ySplit").unwrap_or(0.0) as u32;
            }
        }
    }
    if let Some(cols) = ws.child_local("cols") {
        for col in cols.children_local("col") {
            let (Some(min), Some(max)) = (col.attr("min").and_then(|v| v.parse::<u32>().ok()), col.attr("max").and_then(|v| v.parse::<u32>().ok())) else { continue };
            sheet.cols.push(ColInfo {
                min: min.saturating_sub(1),
                max: max.saturating_sub(1).min(crate::refs::MAX_COLS - 1),
                width: attr_f64(col, "width"),
                hidden: attr_bool(col, "hidden"),
                style: col.attr("style").and_then(|v| v.parse().ok()).filter(|s| *s != 0),
                outline: col.attr("outlineLevel").and_then(|v| v.parse().ok()).unwrap_or(0),
            });
        }
    }
    if let Some(sd) = ws.child_local("sheetData") {
        read_cells(ctx, sd, &mut sheet);
    }
    if let Some(mc) = ws.child_local("mergeCells") {
        sheet.merges = mc.children_local("mergeCell").filter_map(|m| m.attr("ref")).filter(|r| parse_range(r).is_some()).map(String::from).collect();
    }
    if let Some(af) = ws.child_local("autoFilter") {
        sheet.auto_filter = Some(AutoFilter { range: af.attr("ref").unwrap_or_default().to_string(), raw: Some(af.to_xml()), columns: Vec::new() });
    }
    sheet.validations = read_validations(ws);
    sheet.cond_formats = read_cond_formats(ws, ctx.theme);
    sheet.hyperlinks = read_hyperlinks(ctx, ws);
    sheet.notes = read_notes(ctx);
    sheet.tables = read_tables(ctx);
    sheet.drawings = crate::drawing::read_drawings(ctx.pkg, &ctx.part, ctx.theme);
    crate::drawing::fix_sizes(&mut sheet);
    Ok(sheet)
}

/// What the file carries that the editor keeps without editing.
pub fn preserved_inventory(pkg: &Package) -> Vec<Preserved> {
    let mut counts: Vec<(&str, u32, &str, &str)> = vec![
        ("chart", 0, "graphique", "graphiques"),
        ("pivot", 0, "tableau croisé dynamique", "tableaux croisés dynamiques"),
        ("table", 0, "tableau structuré", "tableaux structurés"),
        ("image", 0, "image", "images"),
        ("macro", 0, "projet de macros (non exécuté)", "projets de macros (non exécutés)"),
        ("slicer", 0, "segment", "segments"),
        ("external", 0, "liaison externe", "liaisons externes"),
        ("form", 0, "contrôle de formulaire", "contrôles de formulaire"),
    ];
    for (name, _) in &pkg.parts {
        let kind = if name.starts_with("xl/charts/chart") {
            "chart"
        } else if name.starts_with("xl/pivotTables/") && name.ends_with(".xml") {
            "pivot"
        } else if name.starts_with("xl/tables/") && name.ends_with(".xml") {
            "table"
        } else if name.starts_with("xl/media/") {
            "image"
        } else if name.ends_with("vbaProject.bin") {
            "macro"
        } else if name.starts_with("xl/slicers/") && name.ends_with(".xml") {
            "slicer"
        } else if name.starts_with("xl/externalLinks/") && name.ends_with(".xml") {
            "external"
        } else if name.starts_with("xl/ctrlProps/") {
            "form"
        } else {
            continue;
        };
        if let Some(c) = counts.iter_mut().find(|c| c.0 == kind) {
            c.1 += 1;
        }
    }
    counts
        .into_iter()
        .filter(|c| c.1 > 0)
        .map(|(kind, count, one, many)| Preserved { kind: kind.into(), count, label: format!("{count} {}", if count > 1 { many } else { one }) })
        .collect()
}

pub fn import_xlsx(bytes: &[u8]) -> Result<Workbook, String> {
    let pkg = Package::read(bytes)?;
    let wb_part = workbook_part(&pkg);
    let wb = pkg.get_xml(&wb_part).ok_or("classeur introuvable (xl/workbook.xml)")?;
    let rels = pkg.rels(&wb_part);
    let theme_doc = workbook_rel_target(&pkg, &wb_part, REL_THEME).and_then(|p| pkg.get_xml(&p));
    let theme = theme_colors(theme_doc.as_ref());
    let styles_doc = workbook_rel_target(&pkg, &wb_part, REL_STYLES).and_then(|p| pkg.get_xml(&p));
    let table = read_styles(styles_doc.as_ref(), &theme);
    let strings = read_shared_strings(workbook_rel_target(&pkg, &wb_part, REL_SHARED_STRINGS).and_then(|p| pkg.get_xml(&p)).as_ref());

    let mut out = Workbook {
        base_styles: table.styles.len(),
        styles: table.styles,
        dxfs: table.dxfs,
        source: Source::Xlsx,
        date1904: wb.root.child_local("workbookPr").map(|p| attr_bool(p, "date1904")).unwrap_or(false),
        ..Default::default()
    };
    let sheets_el = wb.root.child_local("sheets").ok_or("aucune feuille")?;
    let mut ids_by_index: Vec<String> = Vec::new();
    for s in sheets_el.children_local("sheet") {
        let name = s.attr("name").unwrap_or("Feuille").to_string();
        let Some(rel) = rel_id_attr(s).and_then(|id| rels.iter().find(|r| r.id == id)) else { continue };
        let part = resolve_target(&wb_part, &rel.target);
        let state = match s.attr("state") {
            Some("hidden") => SheetState::Hidden,
            Some("veryHidden") => SheetState::VeryHidden,
            _ => SheetState::Visible,
        };
        ids_by_index.push(part.clone());
        if rel.rel_type != REL_WORKSHEET {
            // Chart sheets and dialog sheets: kept in the file, not shown as grids.
            continue;
        }
        let ctx = SheetCtx { pkg: &pkg, part, strings: &strings, theme: &theme };
        out.sheets.push(read_sheet(&ctx, &name, state)?);
    }
    if out.sheets.is_empty() {
        return Err("le classeur ne contient aucune feuille de calcul".into());
    }
    if let Some(dn) = wb.root.child_local("definedNames") {
        for d in dn.children_local("definedName") {
            let scope = d.attr("localSheetId").and_then(|i| i.parse::<usize>().ok()).and_then(|i| ids_by_index.get(i)).cloned();
            out.names.push(DefinedName {
                name: d.attr("name").unwrap_or_default().to_string(),
                scope,
                formula: strip_future_prefixes(&d.text_content()),
                hidden: attr_bool(d, "hidden"),
            });
        }
    }
    let active = wb.root.child_local("bookViews").and_then(|b| b.child_local("workbookView")).and_then(|v| v.attr("activeTab")).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    out.active_sheet = ids_by_index.get(active).and_then(|id| out.sheets.iter().position(|s| &s.id == id)).unwrap_or(0);
    out.preserved = preserved_inventory(&pkg);
    Ok(out)
}
