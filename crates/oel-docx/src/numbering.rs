//! `numbering.xml`: list definitions resolved per `numId`, so the editor can
//! draw Word-accurate markers (`1.`, `a)`, `•`, `1.2.`) itself.

use super::package::{DocxPackage, Package, REL_NUMBERING};
use super::styles::Styles;
use super::xml::XElement;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Level {
    pub fmt: String,
    pub text: String,
    pub start: i64,
    pub ind_left: Option<i64>,
    pub hanging: Option<i64>,
    pub font: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Numbering {
    /// numId → (abstractNumId, nine resolved levels).
    pub nums: BTreeMap<i64, (i64, Vec<Level>, bool)>,
    pub max_num_id: i64,
    pub max_abstract_id: i64,
}

fn parse_level(l: &XElement) -> Level {
    let ind = l.child("w:pPr").and_then(|p| p.child("w:ind"));
    let num = |e: Option<&XElement>, k: &str| e.and_then(|e| e.attr(k)).and_then(|v| v.parse::<i64>().ok());
    let font = l.child("w:rPr").and_then(|r| r.child("w:rFonts")).and_then(|f| f.attr("w:ascii").or_else(|| f.attr("w:hAnsi"))).map(String::from);
    let fmt = l.child_val("w:numFmt").unwrap_or("decimal").to_string();
    let raw_text = l.child_val("w:lvlText").unwrap_or("").to_string();
    let text = if fmt == "bullet" { bullet_glyph(&raw_text, font.as_deref()) } else { raw_text };
    Level {
        fmt,
        text,
        start: num(l.child("w:start"), "w:val").unwrap_or(1),
        ind_left: num(ind, "w:left").or_else(|| num(ind, "w:start")),
        hanging: num(ind, "w:hanging"),
        font,
    }
}

/// Symbol/Wingdings private-use bullets → Unicode the browser can draw.
pub fn bullet_glyph(text: &str, font: Option<&str>) -> String {
    let Some(c) = text.chars().next() else { return String::new() };
    let code = c as u32;
    let f = font.unwrap_or("").to_ascii_lowercase();
    let low = if (0xF000..=0xF0FF).contains(&code) { code - 0xF000 } else { code };
    let mapped = match (f.as_str(), low) {
        (_, 0xB7) => '•',
        ("wingdings", 0xA7) => '▪',
        ("wingdings", 0xD8) => '➢',
        ("wingdings", 0x76) => '❖',
        ("wingdings", 0xFC) => '✓',
        ("wingdings", 0xA8) => '◆',
        ("wingdings", 0x6E) => '■',
        ("wingdings", 0x71) => '❑',
        ("wingdings", 0x6F) => '□',
        ("courier new", 0x6F) | ("", 0x6F) => '◦',
        _ if (0xF000..=0xF0FF).contains(&code) => '•',
        _ => c,
    };
    mapped.to_string()
}

impl Numbering {
    pub fn load(pkg: &Package, styles: &Styles) -> Numbering {
        let mut n = Numbering::default();
        let Some(doc) = pkg.get_xml(&pkg.main_related(REL_NUMBERING, "numbering.xml")) else { return n };
        let mut abstracts: BTreeMap<i64, (Vec<Level>, Option<String>)> = BTreeMap::new();
        for a in doc.root.elements().filter(|e| e.name == "w:abstractNum") {
            let id = a.attr("w:abstractNumId").and_then(|v| v.parse().ok()).unwrap_or(0);
            n.max_abstract_id = n.max_abstract_id.max(id);
            let mut levels: Vec<Level> = (0..9).map(|_| Level { fmt: "decimal".into(), text: String::new(), start: 1, ind_left: None, hanging: None, font: None }).collect();
            for l in a.elements().filter(|e| e.name == "w:lvl") {
                let ilvl = l.attr("w:ilvl").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                if ilvl < 9 {
                    levels[ilvl] = parse_level(l);
                }
            }
            abstracts.insert(id, (levels, a.child_val("w:numStyleLink").map(String::from)));
        }
        let mut num_to_abs: BTreeMap<i64, i64> = BTreeMap::new();
        for num in doc.root.elements().filter(|e| e.name == "w:num") {
            let id = num.attr("w:numId").and_then(|v| v.parse().ok()).unwrap_or(0);
            let abs = num.child_val("w:abstractNumId").and_then(|v| v.parse().ok()).unwrap_or(0);
            num_to_abs.insert(id, abs);
        }
        for num in doc.root.elements().filter(|e| e.name == "w:num") {
            let id: i64 = num.attr("w:numId").and_then(|v| v.parse().ok()).unwrap_or(0);
            n.max_num_id = n.max_num_id.max(id);
            let mut abs = num_to_abs.get(&id).copied().unwrap_or(0);
            // numStyleLink → numbering style → its numId → the real abstract.
            if let Some(link) = abstracts.get(&abs).and_then(|(_, l)| l.clone()) {
                if let Some(target) = styles
                    .get(&link)
                    .and_then(|s| s.ppr.as_ref())
                    .and_then(|p| p.child("w:numPr"))
                    .and_then(|np| np.child_val("w:numId"))
                    .and_then(|v| v.parse::<i64>().ok())
                    .and_then(|nid| num_to_abs.get(&nid).copied())
                {
                    abs = target;
                }
            }
            let mut levels = abstracts.get(&abs).map(|(l, _)| l.clone()).unwrap_or_default();
            let mut restarts = false;
            for o in num.elements().filter(|e| e.name == "w:lvlOverride") {
                let ilvl = o.attr("w:ilvl").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                if ilvl >= levels.len() {
                    continue;
                }
                if let Some(lvl) = o.child("w:lvl") {
                    levels[ilvl] = parse_level(lvl);
                    restarts = true;
                }
                if let Some(s) = o.child_val("w:startOverride").and_then(|v| v.parse().ok()) {
                    levels[ilvl].start = s;
                    restarts = true;
                }
            }
            n.nums.insert(id, (abs, levels, restarts));
        }
        n
    }

    pub fn to_json(&self) -> Value {
        let mut nums = serde_json::Map::new();
        for (id, (abs, levels, restarts)) in &self.nums {
            nums.insert(
                id.to_string(),
                json!({
                    "abstractId": abs,
                    "restart": restarts,
                    "levels": levels.iter().map(|l| json!({
                        "fmt": l.fmt, "text": l.text, "start": l.start,
                        "indLeft": l.ind_left, "hanging": l.hanging, "font": l.font,
                    })).collect::<Vec<_>>(),
                }),
            );
        }
        json!({ "nums": nums, "maxNumId": self.max_num_id, "maxAbstractId": self.max_abstract_id })
    }

    pub fn is_bullet(&self, num_id: i64, ilvl: usize) -> Option<bool> {
        self.nums.get(&num_id).and_then(|(_, l, _)| l.get(ilvl)).map(|l| l.fmt == "bullet")
    }
}
