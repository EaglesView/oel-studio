use oel_opc::package::Package;
use oelchart::*;

fn fixture(name: &str) -> Package {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/");
    Package::read(&std::fs::read(format!("{path}{name}")).unwrap()).unwrap()
}

fn office_theme(name: &str) -> Option<String> {
    Some(
        match name {
            "dk1" | "tx1" => "000000",
            "lt1" | "bg1" => "FFFFFF",
            "dk2" | "tx2" => "44546A",
            "lt2" | "bg2" => "E7E6E6",
            "accent1" => "4472C4",
            "accent2" => "ED7D31",
            "accent3" => "A5A5A5",
            "accent4" => "FFC000",
            "accent5" => "5B9BD5",
            "accent6" => "70AD47",
            _ => return None,
        }
        .to_string(),
    )
}

fn theme() -> Theme<'static> {
    Theme { scheme: &office_theme, minor_font: Some("Calibri".into()), major_font: Some("Calibri Light".into()) }
}

#[test]
fn reads_a_column_chart() {
    let pkg = fixture("xlsx/rich.xlsx");
    let spec = read_chart(&pkg, "xl/charts/chart1.xml", &theme()).expect("chart");
    assert!(!spec.ex);
    assert_eq!(spec.title.as_ref().and_then(|t| t.text.as_deref()), Some("Montants"));
    assert_eq!(spec.groups.len(), 1);
    let g = &spec.groups[0];
    assert_eq!(g.kind, "bar");
    assert_eq!(g.bar_dir.as_deref(), Some("col"));
    assert_eq!(g.grouping.as_deref(), Some("clustered"));
    assert_eq!(g.axis_ids, vec![10, 100]);
    let s = &g.series[0];
    assert_eq!(s.name_ref.as_deref(), Some("'Budget'!B1"));
    assert_eq!(s.cat.as_ref().and_then(|c| c.f.as_deref()), Some("'Budget'!$A$2:$A$5"));
    assert_eq!(s.val.as_ref().and_then(|c| c.f.as_deref()), Some("'Budget'!$B$2:$B$5"));
    assert_eq!(spec.axes.len(), 2);
    assert_eq!(spec.axes[0].kind, "cat");
    assert!(spec.axes[1].major_grid.is_some());
    assert_eq!(spec.legend.as_ref().and_then(|l| l.pos.as_deref()), Some("r"));
    // Office default palette: accent1 first, then the darker variation.
    assert_eq!(spec.palette[0], "#4472C4");
    assert_eq!(spec.palette.len(), 36);
}

#[test]
fn reads_a_pareto_chart_ex() {
    let pkg = fixture("xlsx/complex_sheet_graph.xlsx");
    let spec = read_chart(&pkg, "xl/charts/chartEx1.xml", &theme()).expect("chartEx");
    assert!(spec.ex);
    let kinds: Vec<&str> = spec.groups.iter().map(|g| g.kind.as_str()).collect();
    assert_eq!(kinds, ["clusteredColumn", "paretoLine", "clusteredColumn", "paretoLine"]);
    let s = &spec.groups[0].series[0];
    assert_eq!(s.name.as_deref(), Some("OCCURRENCES"));
    assert_eq!(s.val.as_ref().and_then(|v| v.f.as_deref()), Some("_xlchart.v1.3"));
    assert_eq!(s.shape.as_ref().and_then(|s| s.fill.as_ref()).and_then(|f| f.color.as_deref()), Some("#FFC000"));
    assert!(spec.groups[2].series[0].hidden);
    assert_eq!(spec.groups[1].series[0].ex.as_ref().and_then(|e| e.owner), Some(0));
    assert_eq!(spec.axes.iter().map(|a| a.kind.as_str()).collect::<Vec<_>>(), ["cat", "val", "val"]);
    assert_eq!(spec.axes[2].disp_units.as_deref(), Some("percentage"));
    // colors1.xml: the cycle of accents.
    assert_eq!(spec.palette[3], "#FFC000");
}

fn sample() -> ChartSpec {
    let num = |f: &str, v: &[f64]| DataRef { f: Some(f.into()), format: Some("General".into()), num: v.iter().map(|x| Some(*x)).collect(), count: v.len() as u32, ..Default::default() };
    let cat = DataRef { f: Some("Feuil1!$A$2:$A$4".into()), str: vec![Some("Jan".into()), Some("Fév".into()), None], count: 3, ..Default::default() };
    ChartSpec {
        title: Some(Title { text: Some("Ventes".into()), style: Some(TextStyle { size: Some(14.0), bold: Some(false), ..Default::default() }), ..Default::default() }),
        plot_vis_only: true,
        groups: vec![
            Group {
                kind: "bar".into(),
                bar_dir: Some("col".into()),
                grouping: Some("stacked".into()),
                gap_width: Some(150.0),
                overlap: Some(100.0),
                axis_ids: vec![1, 2],
                series: vec![Series {
                    idx: 0,
                    order: 0,
                    name: Some("Nord".into()),
                    name_ref: Some("Feuil1!$B$1".into()),
                    cat: Some(cat.clone()),
                    val: Some(num("Feuil1!$B$2:$B$4", &[1.0, 2.5, 3.0])),
                    shape: Some(Shape { fill: Some(Fill { kind: "solid".into(), color: Some("#4472C4".into()), ..Default::default() }), ..Default::default() }),
                    labels: Some(DataLabels { show_val: true, pos: Some("ctr".into()), ..Default::default() }),
                    ..Default::default()
                }],
                ..Default::default()
            },
            Group {
                kind: "line".into(),
                grouping: Some("standard".into()),
                markers: true,
                axis_ids: vec![1, 3],
                series: vec![Series {
                    idx: 1,
                    order: 1,
                    name: Some("Cible".into()),
                    cat: Some(cat),
                    val: Some(num("Feuil1!$C$2:$C$4", &[2.0, 2.0, 2.0])),
                    shape: Some(Shape { line: Some(Line { color: Some("#ED7D31".into()), width: Some(2.25), ..Default::default() }), ..Default::default() }),
                    marker: Some(Marker { symbol: Some("circle".into()), size: Some(5.0), shape: Some(Shape { fill: Some(Fill { kind: "solid".into(), color: Some("#ED7D31".into()), ..Default::default() }), ..Default::default() }) }),
                    trendlines: vec![Trendline { kind: "linear".into(), disp_r2: true, ..Default::default() }],
                    ..Default::default()
                }],
                ..Default::default()
            },
        ],
        axes: vec![
            Axis { id: 1, kind: "cat".into(), pos: Some("b".into()), cross_ax: Some(2), crosses: Some("autoZero".into()), major_tick: Some("none".into()), minor_tick: Some("none".into()), tick_lbl_pos: Some("nextTo".into()), ..Default::default() },
            Axis {
                id: 2,
                kind: "val".into(),
                pos: Some("l".into()),
                cross_ax: Some(1),
                crosses: Some("autoZero".into()),
                cross_between: Some("between".into()),
                major_grid: Some(Shape::default()),
                num_fmt: Some("#,##0".into()),
                major_tick: Some("none".into()),
                minor_tick: Some("none".into()),
                tick_lbl_pos: Some("nextTo".into()),
                max: Some(10.0),
                ..Default::default()
            },
            Axis { id: 3, kind: "val".into(), pos: Some("r".into()), cross_ax: Some(1), crosses: Some("max".into()), cross_between: Some("between".into()), major_tick: Some("out".into()), minor_tick: Some("none".into()), tick_lbl_pos: Some("nextTo".into()), ..Default::default() },
        ],
        legend: Some(Legend { pos: Some("b".into()), ..Default::default() }),
        disp_blanks_as: Some("gap".into()),
        ..Default::default()
    }
}

#[test]
fn write_then_read_gives_the_same_spec() {
    let spec = sample();
    let xml = write_chart(&spec, None);
    let mut pkg = Package { parts: vec![("xl/charts/chart9.xml".into(), xml.into_bytes())] };
    pkg.set("[Content_Types].xml", b"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>".to_vec());
    let back = read_chart(&pkg, "xl/charts/chart9.xml", &Theme { scheme: &|_| None, minor_font: None, major_font: None }).unwrap();
    let mut expected = spec.clone();
    expected.part = "xl/charts/chart9.xml".into();
    assert_eq!(back, expected, "\n{}", serde_json::to_string_pretty(&back).unwrap());
}

#[test]
fn json_is_camel_case_and_compact() {
    let j = serde_json::to_value(sample()).unwrap();
    assert!(j.get("plotVisOnly").is_none(), "default true is omitted");
    assert_eq!(j["groups"][0]["barDir"], "col");
    assert_eq!(j["axes"][1]["numFmt"], "#,##0");
}

/// Every chart of the generated fixtures reads, with at least one series that has values.
#[test]
fn reads_every_generated_chart() {
    for file in ["charts/generated-charts.pptx", "charts/generated-charts.xlsx"] {
        let pkg = fixture(file);
        let parts: Vec<String> = pkg.parts.iter().map(|(n, _)| n.clone()).filter(|n| n.contains("/charts/chart") && n.ends_with(".xml")).collect();
        assert!(parts.len() > 20, "{file}: {} charts", parts.len());
        for p in parts {
            let spec = read_chart(&pkg, &p, &theme()).unwrap_or_else(|| panic!("{file} {p}"));
            assert!(!spec.groups.is_empty(), "{file} {p}: no group");
            let s = &spec.groups[0].series[0];
            let v = s.val.as_ref().unwrap_or_else(|| panic!("{file} {p}: no values"));
            assert!(v.f.is_some(), "{file} {p}: no reference");
            if file.ends_with(".pptx") {
                assert!(v.num.iter().any(|x| x.is_some()), "{file} {p}: pptx charts carry their cache");
            }
        }
    }
}

#[test]
fn automatic_colours_are_written_out() {
    let mut spec = sample();
    spec.groups[0].series[0].shape = None;
    spec.groups.push(Group { kind: "pie".into(), vary_colors: true, series: vec![Series { idx: 5, order: 5, val: Some(DataRef { num: vec![Some(1.0), Some(2.0)], count: 2, ..Default::default() }), ..Default::default() }], ..Default::default() });
    let xml = write_chart(&spec, None);
    assert!(xml.contains(r#"<c:ser><c:idx val="0"/><c:order val="0"/>"#));
    // Series 0 gets accent 1, the pie's points accents 1 and 2.
    assert!(xml.contains(r#"<c:spPr><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></c:spPr><c:invertIfNegative"#), "{xml}");
    assert_eq!(xml.matches("<c:dPt>").count(), 2);
}
