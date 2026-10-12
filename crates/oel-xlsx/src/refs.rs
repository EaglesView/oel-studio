//! A1 addresses and a small formula scanner.
//!
//! The scanner only needs to find cell references and function names in
//! English Excel formulas (shared-formula expansion, `_xlfn.` prefixes). It
//! skips string literals, quoted sheet names and structured references, and
//! does not treat `LOG10(` or a defined name as a reference.

pub const MAX_ROWS: u32 = 1_048_576;
pub const MAX_COLS: u32 = 16_384;

/// 0 → `A`, 25 → `Z`, 26 → `AA`.
pub fn col_name(mut c: u32) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (c % 26) as u8);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

/// `AA` → 26. Case-insensitive; `None` past `XFD`.
pub fn col_index(s: &str) -> Option<u32> {
    if s.is_empty() || s.len() > 3 {
        return None;
    }
    let mut n: u32 = 0;
    for b in s.bytes() {
        let b = b.to_ascii_uppercase();
        if !b.is_ascii_uppercase() {
            return None;
        }
        n = n * 26 + (b - b'A' + 1) as u32;
    }
    (n >= 1 && n <= MAX_COLS).then(|| n - 1)
}

/// 0-based `(row, col)` → `B3`.
pub fn a1(r: u32, c: u32) -> String {
    format!("{}{}", col_name(c), r + 1)
}

/// `B3` / `$B$3` → 0-based `(row, col)`.
pub fn parse_a1(s: &str) -> Option<(u32, u32)> {
    let s = s.replace('$', "");
    let split = s.find(|ch: char| ch.is_ascii_digit())?;
    let (letters, digits) = s.split_at(split);
    let c = col_index(letters)?;
    let r: u32 = digits.parse().ok()?;
    (r >= 1 && r <= MAX_ROWS).then(|| (r - 1, c))
}

/// A rectangular range, 0-based and inclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl Range {
    pub fn contains(&self, r: u32, c: u32) -> bool {
        r >= self.r0 && r <= self.r1 && c >= self.c0 && c <= self.c1
    }
    pub fn to_a1(&self) -> String {
        if self.r0 == self.r1 && self.c0 == self.c1 { a1(self.r0, self.c0) } else { format!("{}:{}", a1(self.r0, self.c0), a1(self.r1, self.c1)) }
    }
}

/// `A1:C3` or `B2` (a single cell is a 1×1 range).
pub fn parse_range(s: &str) -> Option<Range> {
    let (a, b) = s.split_once(':').unwrap_or((s, s));
    let (r0, c0) = parse_a1(a)?;
    let (r1, c1) = parse_a1(b)?;
    Some(Range { r0: r0.min(r1), c0: c0.min(c1), r1: r0.max(r1), c1: c0.max(c1) })
}

/// A space-separated `sqref` (`A1:B2 D4`).
pub fn parse_sqref(s: &str) -> Vec<Range> {
    s.split_whitespace().filter_map(parse_range).collect()
}

/// One cell-reference endpoint found in a formula.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefPart {
    /// `$A$1`: (col, col_abs, row, row_abs), 0-based.
    Cell { col: u32, col_abs: bool, row: u32, row_abs: bool },
    /// Whole column endpoint (`A` in `A:C`).
    Col { col: u32, abs: bool },
    /// Whole row endpoint (`3` in `3:5`).
    Row { row: u32, abs: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token<'a> {
    /// Anything we copy through unchanged.
    Text(&'a str),
    /// A reference: optional `Sheet!` prefix (as written) and one or two endpoints.
    Ref { sheet: Option<&'a str>, start: RefPart, end: Option<RefPart> },
    /// A function name, without the `(`.
    Func(&'a str),
}

fn ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b >= 0x80
}

/// Scan `$?LETTERS$?DIGITS` at `i`; returns (part, end).
fn scan_cell(s: &[u8], i: usize) -> Option<(RefPart, usize)> {
    let mut j = i;
    let col_abs = s.get(j) == Some(&b'$');
    if col_abs {
        j += 1;
    }
    let cs = j;
    while j < s.len() && s[j].is_ascii_alphabetic() {
        j += 1;
    }
    let letters = std::str::from_utf8(&s[cs..j]).ok()?;
    let col = col_index(letters)?;
    let row_abs = s.get(j) == Some(&b'$');
    if row_abs {
        j += 1;
    }
    let rs = j;
    while j < s.len() && s[j].is_ascii_digit() {
        j += 1;
    }
    if rs == j {
        return None;
    }
    let row: u32 = std::str::from_utf8(&s[rs..j]).ok()?.parse().ok()?;
    if row == 0 || row > MAX_ROWS {
        return None;
    }
    Some((RefPart::Cell { col, col_abs, row: row - 1, row_abs }, j))
}

fn scan_col(s: &[u8], i: usize) -> Option<(RefPart, usize)> {
    let mut j = i;
    let abs = s.get(j) == Some(&b'$');
    if abs {
        j += 1;
    }
    let cs = j;
    while j < s.len() && s[j].is_ascii_alphabetic() {
        j += 1;
    }
    let col = col_index(std::str::from_utf8(&s[cs..j]).ok()?)?;
    Some((RefPart::Col { col, abs }, j))
}

fn scan_row(s: &[u8], i: usize) -> Option<(RefPart, usize)> {
    let mut j = i;
    let abs = s.get(j) == Some(&b'$');
    if abs {
        j += 1;
    }
    let rs = j;
    while j < s.len() && s[j].is_ascii_digit() {
        j += 1;
    }
    if rs == j {
        return None;
    }
    let row: u32 = std::str::from_utf8(&s[rs..j]).ok()?.parse().ok()?;
    (row >= 1 && row <= MAX_ROWS).then(|| (RefPart::Row { row: row - 1, abs }, j))
}

/// Try a reference (single cell, cell range, column range or row range) at `i`.
fn scan_ref(s: &[u8], i: usize) -> Option<(RefPart, Option<RefPart>, usize)> {
    let follows_ok = |j: usize| j >= s.len() || !(ident_char(s[j]) || s[j] == b'(' || s[j] == b'!' || s[j] == b'[');
    if let Some((a, j)) = scan_cell(s, i) {
        if s.get(j) == Some(&b':') {
            if let Some((b, k)) = scan_cell(s, j + 1) {
                if follows_ok(k) {
                    return Some((a, Some(b), k));
                }
            }
        }
        return follows_ok(j).then_some((a, None, j));
    }
    if let Some((a, j)) = scan_col(s, i) {
        if s.get(j) == Some(&b':') {
            if let Some((b, k)) = scan_col(s, j + 1) {
                if follows_ok(k) {
                    return Some((a, Some(b), k));
                }
            }
        }
    }
    if let Some((a, j)) = scan_row(s, i) {
        if s.get(j) == Some(&b':') {
            if let Some((b, k)) = scan_row(s, j + 1) {
                if follows_ok(k) {
                    return Some((a, Some(b), k));
                }
            }
        }
    }
    None
}

/// Split a formula (without `=`) into text, references and function names.
pub fn tokenize<'a>(f: &'a str) -> Vec<Token<'a>> {
    let s = f.as_bytes();
    let mut out = Vec::new();
    let mut text_start = 0;
    let mut i = 0;
    let flush = |out: &mut Vec<Token<'a>>, from: usize, to: usize| {
        if to > from {
            out.push(Token::Text(&f[from..to]));
        }
    };
    while i < s.len() {
        let b = s[i];
        // String literal.
        if b == b'"' {
            i += 1;
            while i < s.len() {
                if s[i] == b'"' {
                    if s.get(i + 1) == Some(&b'"') {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            i += 1;
            continue;
        }
        // Structured reference or external-book index: copy through.
        if b == b'[' {
            let mut depth = 0;
            while i < s.len() {
                if s[i] == b'[' {
                    depth += 1;
                } else if s[i] == b']' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                i += 1;
            }
            i += 1;
            continue;
        }
        let prev_ident = i > 0 && (ident_char(s[i - 1]) || s[i - 1] == b'$');
        if prev_ident {
            i += 1;
            continue;
        }
        // Quoted sheet name: 'My sheet'!A1
        if b == b'\'' {
            let start = i;
            i += 1;
            while i < s.len() {
                if s[i] == b'\'' {
                    if s.get(i + 1) == Some(&b'\'') {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            i += 1;
            if s.get(i) == Some(&b'!') {
                if let Some((a, b2, end)) = scan_ref(s, i + 1) {
                    flush(&mut out, text_start, start);
                    out.push(Token::Ref { sheet: Some(&f[start..i]), start: a, end: b2 });
                    i = end;
                    text_start = i;
                }
            }
            continue;
        }
        if b.is_ascii_alphabetic() || b == b'_' || b == b'$' || b.is_ascii_digit() || b >= 0x80 {
            // Plain reference first.
            if let Some((a, b2, end)) = scan_ref(s, i) {
                flush(&mut out, text_start, i);
                out.push(Token::Ref { sheet: None, start: a, end: b2 });
                i = end;
                text_start = i;
                continue;
            }
            // Identifier: function name, sheet prefix or defined name.
            let start = i;
            while i < s.len() && ident_char(s[i]) {
                i += 1;
            }
            if i == start {
                i += 1;
                continue;
            }
            if s.get(i) == Some(&b'!') {
                if let Some((a, b2, end)) = scan_ref(s, i + 1) {
                    flush(&mut out, text_start, start);
                    out.push(Token::Ref { sheet: Some(&f[start..i]), start: a, end: b2 });
                    i = end;
                    text_start = i;
                }
                continue;
            }
            if s.get(i) == Some(&b'(') && (s[start].is_ascii_alphabetic() || s[start] == b'_') {
                flush(&mut out, text_start, start);
                out.push(Token::Func(&f[start..i]));
                text_start = i;
            }
            continue;
        }
        i += 1;
    }
    flush(&mut out, text_start, s.len());
    out
}

fn part_to_string(p: &RefPart) -> String {
    match *p {
        RefPart::Cell { col, col_abs, row, row_abs } => {
            format!("{}{}{}{}", if col_abs { "$" } else { "" }, col_name(col), if row_abs { "$" } else { "" }, row + 1)
        }
        RefPart::Col { col, abs } => format!("{}{}", if abs { "$" } else { "" }, col_name(col)),
        RefPart::Row { row, abs } => format!("{}{}", if abs { "$" } else { "" }, row + 1),
    }
}

/// Serialize tokens back to formula text.
pub fn render(tokens: &[Token<'_>]) -> String {
    let mut out = String::new();
    for t in tokens {
        match t {
            Token::Text(s) | Token::Func(s) => out.push_str(s),
            Token::Ref { sheet, start, end } => {
                if let Some(sh) = sheet {
                    out.push_str(sh);
                    out.push('!');
                }
                out.push_str(&part_to_string(start));
                if let Some(e) = end {
                    out.push(':');
                    out.push_str(&part_to_string(e));
                }
            }
        }
    }
    out
}

fn shift_part(p: &RefPart, dr: i64, dc: i64) -> Option<RefPart> {
    let sh = |v: u32, d: i64, abs: bool, max: u32| -> Option<u32> {
        if abs {
            return Some(v);
        }
        let n = v as i64 + d;
        (n >= 0 && n < max as i64).then_some(n as u32)
    };
    Some(match *p {
        RefPart::Cell { col, col_abs, row, row_abs } => {
            RefPart::Cell { col: sh(col, dc, col_abs, MAX_COLS)?, col_abs, row: sh(row, dr, row_abs, MAX_ROWS)?, row_abs }
        }
        RefPart::Col { col, abs } => RefPart::Col { col: sh(col, dc, abs, MAX_COLS)?, abs },
        RefPart::Row { row, abs } => RefPart::Row { row: sh(row, dr, abs, MAX_ROWS)?, abs },
    })
}

/// Move a formula by (dr, dc) the way copy/fill does: relative parts shift,
/// `$` parts stay. References pushed off the grid become `#REF!`.
pub fn shift_formula(f: &str, dr: i64, dc: i64) -> String {
    let mut out = String::new();
    for t in tokenize(f) {
        match t {
            Token::Ref { sheet, start, end } => {
                let s2 = shift_part(&start, dr, dc);
                let e2 = end.as_ref().map(|e| shift_part(e, dr, dc));
                match (s2, e2) {
                    (Some(s2), None) => out.push_str(&render(&[Token::Ref { sheet, start: s2, end: None }])),
                    (Some(s2), Some(Some(e2))) => out.push_str(&render(&[Token::Ref { sheet, start: s2, end: Some(e2) }])),
                    _ => {
                        if let Some(sh) = sheet {
                            out.push_str(sh);
                            out.push('!');
                        }
                        out.push_str("#REF!");
                    }
                }
            }
            other => out.push_str(&render(&[other])),
        }
    }
    out
}

/// Functions Excel stores with a `_xlfn.` prefix (newer than Excel 2007).
const XLFN: &[&str] = &[
    "ACOT", "ACOTH", "AGGREGATE", "ARABIC", "ARRAYTOTEXT", "BASE", "BETA.DIST", "BETA.INV", "BINOM.DIST", "BINOM.DIST.RANGE", "BINOM.INV", "BITAND", "BITLSHIFT",
    "BITOR", "BITRSHIFT", "BITXOR", "BYCOL", "BYROW", "CEILING.MATH", "CEILING.PRECISE", "CHIDIST", "CHISQ.DIST", "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "CHISQ.TEST",
    "CHOOSECOLS", "CHOOSEROWS", "COMBINA", "CONCAT", "CONFIDENCE.NORM", "CONFIDENCE.T", "COT", "COTH", "COVARIANCE.P", "COVARIANCE.S", "CSC", "CSCH", "DAYS", "DECIMAL",
    "DROP", "ERF.PRECISE", "ERFC.PRECISE", "EXPAND", "EXPON.DIST", "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "F.TEST", "FILTER", "FILTERXML", "FLOOR.MATH",
    "FLOOR.PRECISE", "FORECAST.ETS", "FORECAST.LINEAR", "FORMULATEXT", "GAMMA", "GAMMA.DIST", "GAMMA.INV", "GAMMALN.PRECISE", "GAUSS", "HSTACK", "HYPGEOM.DIST", "IFNA",
    "IFS", "IMAGE", "IMCOSH", "IMCOT", "IMCSC", "IMCSCH", "IMSEC", "IMSECH", "IMSINH", "IMTAN", "ISFORMULA", "ISOMITTED", "ISOWEEKNUM", "LAMBDA", "LET", "LOGNORM.DIST",
    "LOGNORM.INV", "MAKEARRAY", "MAP", "MAXIFS", "MINIFS", "MODE.MULT", "MODE.SNGL", "MUNIT", "NEGBINOM.DIST", "NETWORKDAYS.INTL", "NORM.DIST", "NORM.INV", "NORM.S.DIST",
    "NORM.S.INV", "NUMBERVALUE", "PDURATION", "PERCENTILE.EXC", "PERCENTILE.INC", "PERCENTRANK.EXC", "PERCENTRANK.INC", "PERMUTATIONA", "PHI", "POISSON.DIST",
    "QUARTILE.EXC", "QUARTILE.INC", "QUERYSTRING", "RANDARRAY", "RANK.AVG", "RANK.EQ", "REDUCE", "RRI", "SCAN", "SEC", "SECH", "SEQUENCE", "SHEET", "SHEETS",
    "SKEW.P", "SORT", "SORTBY", "STDEV.P", "STDEV.S", "SWITCH", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "T.TEST", "TAKE", "TEXTAFTER", "TEXTBEFORE",
    "TEXTJOIN", "TEXTSPLIT", "TOCOL", "TOROW", "UNICHAR", "UNICODE", "UNIQUE", "VALUETOTEXT", "VAR.P", "VAR.S", "VSTACK", "WEBSERVICE", "WEIBULL.DIST", "WORKDAY.INTL",
    "WRAPCOLS", "WRAPROWS", "XLOOKUP", "XMATCH", "XOR", "Z.TEST",
];

/// Functions that are also in the `_xlws.` namespace (worksheet-only).
const XLWS: &[&str] = &["FILTER", "SORT"];

/// `_xlfn.CONCAT(…)` → `CONCAT(…)`, for the editor and the engine.
pub fn strip_future_prefixes(f: &str) -> String {
    if !f.contains("_xl") {
        return f.to_string();
    }
    let mut out = String::new();
    for t in tokenize(f) {
        match t {
            Token::Func(name) => {
                let mut n = name;
                for p in ["_xlfn.", "_xlws."] {
                    if let Some(rest) = n.strip_prefix(p) {
                        n = rest;
                    }
                }
                let n = n.strip_prefix("_xlws.").unwrap_or(n);
                out.push_str(n);
            }
            other => out.push_str(&render(&[other])),
        }
    }
    out
}

/// The inverse, for writing: Excel shows `#NAME?` for new functions without it.
pub fn add_future_prefixes(f: &str) -> String {
    let mut out = String::new();
    for t in tokenize(f) {
        match t {
            Token::Func(name) => {
                let up = name.to_ascii_uppercase();
                if !name.starts_with("_xl") && XLFN.contains(&up.as_str()) {
                    out.push_str("_xlfn.");
                    if XLWS.contains(&up.as_str()) {
                        out.push_str("_xlws.");
                    }
                }
                out.push_str(name);
            }
            other => out.push_str(&render(&[other])),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns() {
        assert_eq!(col_name(0), "A");
        assert_eq!(col_name(25), "Z");
        assert_eq!(col_name(26), "AA");
        assert_eq!(col_name(16383), "XFD");
        assert_eq!(col_index("XFD"), Some(16383));
        assert_eq!(col_index("XFE"), None);
        assert_eq!(parse_a1("$B$3"), Some((2, 1)));
        assert_eq!(parse_range("C3:A1").unwrap().to_a1(), "A1:C3");
    }

    #[test]
    fn shifting() {
        assert_eq!(shift_formula("B2/$B$7", 1, 0), "B3/$B$7");
        assert_eq!(shift_formula("SUM(A1:A5)+Feuil2!C$1", 2, 1), "SUM(B3:B7)+Feuil2!D$1");
        assert_eq!(shift_formula("'Mon budget'!A1*2", 1, 1), "'Mon budget'!B2*2");
        assert_eq!(shift_formula("SUM(A:A)+SUM(3:4)", 1, 1), "SUM(B:B)+SUM(4:5)");
        assert_eq!(shift_formula("A1", -1, 0), "#REF!");
        // Strings, functions that look like refs, defined names and structured refs are left alone.
        assert_eq!(shift_formula("\"A1\"&LOG10(A1)&Montants&Table1[Col A1]", 1, 0), "\"A1\"&LOG10(A2)&Montants&Table1[Col A1]");
        assert_eq!(shift_formula("TEXT(B2,\"0.00\")", 1, 0), "TEXT(B3,\"0.00\")");
        // A bare 0 is a number, not row 0 (used to underflow).
        assert_eq!(shift_formula("ROUND(A1,0)+0", 1, 0), "ROUND(A2,0)+0");
    }

    #[test]
    fn prefixes() {
        assert_eq!(strip_future_prefixes("_xlfn.CONCAT(A1,_xlfn._xlws.SORT(B1:B3))"), "CONCAT(A1,SORT(B1:B3))");
        assert_eq!(add_future_prefixes("CONCAT(A1,SORT(B1:B3))+SUM(1)"), "_xlfn.CONCAT(A1,_xlfn._xlws.SORT(B1:B3))+SUM(1)");
        assert_eq!(add_future_prefixes("_xlfn.XLOOKUP(1,A:A,B:B)"), "_xlfn.XLOOKUP(1,A:A,B:B)");
    }
}
