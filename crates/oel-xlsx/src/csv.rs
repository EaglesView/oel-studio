//! Delimited text (`.csv`, `.tsv`) ↔ one-sheet [`Workbook`], keeping the
//! file's dialect: delimiter, encoding, BOM, line endings and decimal mark.
//!
//! Values are typed the way Excel does on open (numbers, TRUE/FALSE, ISO
//! dates), except that leading-zero codes stay text and a cell starting with
//! `=` stays text: opening a CSV never runs formulas.

use crate::engine::Calc;
use crate::model::{Cell, CellStyle, CsvDialect, Sheet, Source, Workbook};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    /// Force a delimiter (`\t` for `.tsv`); sniffed when absent.
    #[serde(default)]
    pub delimiter: Option<String>,
    /// Force an encoding (`utf-8`, `windows-1252`); detected when absent.
    #[serde(default)]
    pub encoding: Option<String>,
    /// Sheet name (Excel uses the file name).
    #[serde(default)]
    pub sheet_name: Option<String>,
}

const DATE_FMT: &str = "yyyy-mm-dd";

fn decode(bytes: &[u8], forced: Option<&str>) -> (String, &'static str, bool) {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8", true);
    }
    if bytes.starts_with(b"\xFF\xFE") || bytes.starts_with(b"\xFE\xFF") {
        let (enc, _) = encoding_rs::Encoding::for_bom(bytes).unwrap();
        let (text, _, _) = enc.decode(bytes);
        return (text.into_owned(), "utf-16", true);
    }
    match forced {
        Some("windows-1252") => (encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(), "windows-1252", false),
        Some("utf-8") => (String::from_utf8_lossy(bytes).into_owned(), "utf-8", false),
        _ => match std::str::from_utf8(bytes) {
            Ok(s) => (s.to_string(), "utf-8", false),
            // Not UTF-8: almost always Windows-1252 for files from French Excel.
            Err(_) => (encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(), "windows-1252", false),
        },
    }
}

/// The delimiter whose count per line is most consistent (and non-zero).
fn sniff_delimiter(text: &str) -> char {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(30).collect();
    let mut best = (',', 0usize, 0usize);
    for d in [',', ';', '\t', '|'] {
        let counts: Vec<usize> = lines
            .iter()
            .map(|l| {
                let mut q = false;
                l.chars().filter(|c| {
                    if *c == '"' {
                        q = !q;
                    }
                    !q && *c == d
                })
                .count()
            })
            .collect();
        let Some(&first) = counts.first() else { continue };
        if first == 0 {
            continue;
        }
        let consistent = counts.iter().filter(|c| **c == first).count();
        if (consistent, first) > (best.1, best.2) {
            best = (d, consistent, first);
        }
    }
    best.0
}

fn is_plain_number(s: &str, decimal_comma: bool) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() || t.len() > 30 {
        return None;
    }
    let b = t.as_bytes();
    let digits_start = if b[0] == b'-' { 1 } else { 0 };
    // "007" and "0123" are codes; "0" and "0.5" are numbers.
    if b.len() > digits_start + 1 && b[digits_start] == b'0' && b[digits_start + 1].is_ascii_digit() {
        return None;
    }
    let normalized = if decimal_comma {
        if t.contains('.') {
            return None;
        }
        t.replacen(',', ".", 1)
    } else {
        if t.contains(',') {
            return None;
        }
        t.to_string()
    };
    let ok = normalized.bytes().enumerate().all(|(i, c)| c.is_ascii_digit() || c == b'.' || c == b'e' || c == b'E' || ((c == b'-' || c == b'+') && (i == 0 || matches!(normalized.as_bytes()[i - 1], b'e' | b'E'))));
    if !ok || !normalized.bytes().any(|c| c.is_ascii_digit()) || normalized.starts_with('+') {
        return None;
    }
    normalized.parse::<f64>().ok().filter(|f| f.is_finite())
}

/// `YYYY-MM-DD` → Excel serial (1900 system).
fn iso_date_serial(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: i64 = s[5..7].parse().ok()?;
    let d: i64 = s[8..10].parse().ok()?;
    if !(1900..=9999).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let mdays = [31, if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if d > mdays[(m - 1) as usize] {
        return None;
    }
    // Days from civil (Howard Hinnant), relative to 1899-12-30 (Excel's day 0 with the 1900 bug).
    let days = |y: i64, m: i64, d: i64| {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe
    };
    Some((days(y, m, d) - days(1899, 12, 30)) as f64)
}

pub fn import_csv(bytes: &[u8], opts: &CsvOptions) -> Result<Workbook, String> {
    let (text, encoding, bom) = decode(bytes, opts.encoding.as_deref());
    let delimiter = match opts.delimiter.as_deref() {
        Some("\\t") | Some("\t") => '\t',
        Some(d) if d.chars().count() == 1 => d.chars().next().unwrap(),
        _ => sniff_delimiter(&text),
    };
    let line_ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut rdr = ::csv::ReaderBuilder::new().has_headers(false).flexible(true).delimiter(delimiter as u8).from_reader(text.as_bytes());
    let records: Vec<Vec<String>> = rdr.records().map(|r| r.map(|r| r.iter().map(String::from).collect()).map_err(|e| e.to_string())).collect::<Result<_, _>>()?;
    // French Excel: `;` lists go with decimal commas. Only when some value proves it.
    let decimal_comma = delimiter == ';' && records.iter().flatten().any(|v| is_plain_number(v, true).is_some() && v.contains(','));

    let mut styles = vec![CellStyle { num_fmt: "General".into(), locked: true, ..Default::default() }];
    let mut style_for = |code: &str| -> u32 {
        match styles.iter().position(|s| s.num_fmt == code) {
            Some(i) => i as u32,
            None => {
                styles.push(CellStyle { num_fmt: code.into(), locked: true, ..Default::default() });
                (styles.len() - 1) as u32
            }
        }
    };
    let mut cells = Vec::new();
    for (r, rec) in records.iter().enumerate() {
        for (c, v) in rec.iter().enumerate() {
            if v.is_empty() {
                continue;
            }
            let mut cell = Cell { r: r as u32, c: c as u32, ..Default::default() };
            if let Some(n) = is_plain_number(v, decimal_comma) {
                cell.t = Some("n".into());
                cell.v = Some(serde_json::json!(n));
                // "1234,50": keep the trailing zero on screen and on save.
                let sep = if decimal_comma { ',' } else { '.' };
                if let Some((_, frac)) = v.trim().split_once(sep) {
                    if frac.ends_with('0') && frac.bytes().all(|b| b.is_ascii_digit()) {
                        cell.s = style_for(&format!("0.{}", "0".repeat(frac.len())));
                    }
                }
            } else if v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("false") {
                cell.t = Some("b".into());
                cell.v = Some(serde_json::Value::Bool(v.eq_ignore_ascii_case("true")));
            } else if let Some(serial) = iso_date_serial(v.trim()) {
                cell.t = Some("n".into());
                cell.v = Some(serde_json::json!(serial));
                cell.s = style_for(DATE_FMT);
            } else {
                cell.t = Some("s".into());
                cell.v = Some(serde_json::Value::String(v.clone()));
            }
            cells.push(cell);
        }
    }
    let sheet = Sheet {
        id: "xl/worksheets/sheet1.xml".into(),
        name: opts.sheet_name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Feuille 1".into()),
        cells,
        zoom: 100,
        show_grid: true,
        default_col_width: crate::model::default_col_width(),
        default_row_height: crate::model::default_row_height(),
        ..Default::default()
    };
    Ok(Workbook {
        sheets: vec![sheet],
        styles,
        // The `.xlsx` template has one cell format; anything else is appended on save.
        base_styles: 1,
        source: Source::Csv,
        csv: Some(CsvDialect {
            delimiter: delimiter.to_string(),
            encoding: if encoding == "utf-16" { "utf-8".into() } else { encoding.into() },
            bom,
            line_ending: line_ending.into(),
            decimal_comma,
        }),
        ..Default::default()
    })
}

/// Write one sheet as delimited text, values as displayed (as Excel does).
/// Returns the bytes and how many characters the encoding could not represent.
pub fn export_csv(wb: &Workbook, sheet: usize, dialect: Option<&CsvDialect>) -> Result<(Vec<u8>, usize), String> {
    let default = CsvDialect { delimiter: ",".into(), encoding: "utf-8".into(), bom: true, line_ending: "\r\n".into(), decimal_comma: false };
    let d = dialect.or(wb.csv.as_ref()).unwrap_or(&default);
    let s = wb.sheets.get(sheet).ok_or("feuille introuvable")?;
    let calc = Calc::new(wb)?;
    let (rows, cols) = s.cells.iter().fold((0u32, 0u32), |(r, c), x| (r.max(x.r + 1), c.max(x.c + 1)));
    let mut grid = vec![vec![String::new(); cols as usize]; rows as usize];
    for cell in &s.cells {
        if let Some(o) = calc.cell_out(sheet, cell.r, cell.c) {
            let text = if d.decimal_comma && o.t == "n" { o.text.replace(',', "\u{0}").replace('.', ",").replace('\u{0}', ".") } else { o.text };
            grid[cell.r as usize][cell.c as usize] = text;
        }
    }
    let delim = d.delimiter.chars().next().unwrap_or(',');
    let mut w = ::csv::WriterBuilder::new()
        .delimiter(delim as u8)
        .terminator(if d.line_ending == "\n" { ::csv::Terminator::Any(b'\n') } else { ::csv::Terminator::CRLF })
        .flexible(true)
        .from_writer(Vec::new());
    for row in &grid {
        // Excel writes the full rectangle, empty fields included.
        w.write_record(row).map_err(|e| e.to_string())?;
    }
    let text = String::from_utf8(w.into_inner().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut lost = 0;
    let mut out = Vec::new();
    if d.encoding == "windows-1252" {
        for ch in text.chars() {
            let mut buf = [0u8; 4];
            let (bytes, _, unmappable) = encoding_rs::WINDOWS_1252.encode(ch.encode_utf8(&mut buf));
            if unmappable {
                lost += 1;
                out.push(b'?');
            } else {
                out.extend_from_slice(&bytes);
            }
        }
    } else {
        if d.bom {
            out.extend_from_slice(b"\xEF\xBB\xBF");
        }
        out.extend_from_slice(text.as_bytes());
    }
    Ok((out, lost))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert_eq!(is_plain_number("1234.5", false), Some(1234.5));
        assert_eq!(is_plain_number("1234,50", true), Some(1234.5));
        assert_eq!(is_plain_number("1234,50", false), None);
        assert_eq!(is_plain_number("007", false), None);
        assert_eq!(is_plain_number("0.5", false), Some(0.5));
        assert_eq!(is_plain_number("-3e2", false), Some(-300.0));
        assert_eq!(is_plain_number("1-2", false), None);
        assert_eq!(iso_date_serial("2026-01-01"), Some(46023.0));
        assert_eq!(iso_date_serial("2026-02-30"), None);
    }
}
