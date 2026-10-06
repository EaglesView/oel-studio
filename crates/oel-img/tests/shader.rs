//! The WGSL passes parse and validate without a GPU (the parity test needs an adapter).

#[test]
fn passes_wgsl_validates() {
    let src = include_str!("../src/gpu/passes.wgsl");
    let module = naga::front::wgsl::parse_str(src).unwrap_or_else(|e| panic!("{}", e.emit_to_string(src)));
    naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module)
        .unwrap_or_else(|e| panic!("{}", e.emit_to_string(src)));
    for entry in ["fs_input", "fs_extract", "fs_down", "fs_blur", "fs_up", "fs_tone", "fs_color", "fs_texture_clarity", "fs_dehaze_vibrance", "fs_noise", "fs_sharpen", "fs_final"] {
        assert!(module.entry_points.iter().any(|e| e.name == entry), "{entry}");
    }
}
