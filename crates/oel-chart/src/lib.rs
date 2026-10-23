//! DrawingML charts shared by the OutilsEnLigne codecs.
//!
//! - [`model`]: [`ChartSpec`], the JSON the editors draw and edit.
//! - [`read`]: chart part (`c:chartSpace`, `cx:chartSpace`) → [`ChartSpec`].
//! - [`write`]: [`ChartSpec`] → `c:chartSpace` (charts made or edited in the editor).
//!
//! Hosts (xlsx drawings, pptx graphic frames, docx drawings) find the chart part
//! with [`read::chart_part`] and keep it byte for byte unless the spec changed.

pub mod model;
pub mod read;
pub mod write;

pub use model::*;
pub use read::{MAX_POINTS, Theme, chart_part, read_chart};
pub use write::write_chart;

/// Next free `chartN.xml` name in `dir` (`xl/charts`, `ppt/charts`, `word/charts`).
pub fn next_chart_part(pkg: &oel_opc::package::Package, dir: &str) -> String {
    let mut n = 1;
    loop {
        let name = format!("{dir}/chart{n}.xml");
        if !pkg.has(&name) {
            return name;
        }
        n += 1;
    }
}
