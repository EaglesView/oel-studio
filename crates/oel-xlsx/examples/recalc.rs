//! Bake a workbook written by another tool (openpyxl writes formulas without results and
//! charts without caches): compute every formula with IronCalc, fill every chart's caches from
//! the cells, and write it back through the codec.
//!
//!     cargo run -p oel-xlsx --example recalc -- in.xlsx out.xlsx
use oelxlsx::{drawing_write::fill_caches, engine::recalc, export_xlsx, import_xlsx};

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else { return Err("usage: recalc <in.xlsx> <out.xlsx>".into()) };
    let bytes = std::fs::read(input).map_err(|e| format!("{input}: {e}"))?;
    let mut wb = import_xlsx(&bytes)?;
    recalc(&mut wb)?;
    let values = wb.clone();
    for sheet in &mut wb.sheets {
        let name = sheet.name.clone();
        for d in &mut sheet.drawings {
            if let Some(spec) = d.chart.as_mut() {
                fill_caches(spec, &values, &name);
            }
        }
    }
    std::fs::write(output, export_xlsx(&wb, Some(&bytes))?).map_err(|e| format!("{output}: {e}"))?;
    Ok(())
}
