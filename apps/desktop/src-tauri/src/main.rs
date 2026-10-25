//! Desktop shell: serves `apps/web/dist` in a native webview, starting on the Bureau.
//! Everything else (engines, desk, storage) is the web front end as it is (plan 2026-10-desktop, D1, D2).

// No console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

fn main() {
    tauri::Builder::default()
        // First, so a second launch stops before starting anything: the running app comes to the
        // front instead (D-3 adds the files the second launch was asked to open).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // Size, position and maximised state come back; decorations never do (the window has its own).
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() - StateFlags::DECORATIONS).build())
        .setup(|app| {
            main_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the desktop app could not start");
}

/// The Bureau's window. Its title bar is the web page's own (`apps/web/src/desktop`, Figma « Editor —
/// Behaviors », section P): on macOS the native traffic lights sit inside it; on Windows and Linux
/// the window has no system frame and the page draws the window buttons.
fn main_window(app: &tauri::App) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/bureau/".into()))
        .title("Bureau")
        .inner_size(1440.0, 900.0)
        .min_inner_size(720.0, 480.0);
    // Files dropped from the file manager: on Windows, as HTML drops (the native handler would also
    // block drags inside the page, such as reordering sheet tabs); elsewhere natively, with their
    // paths, and `@oel/platform/desktop` hands them to the page. The fs plugin lets the page read
    // exactly the dropped paths.
    #[cfg(windows)]
    let builder = builder.disable_drag_drop_handler();
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // Centred in the page's 40 px bar.
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    builder.build()?;
    Ok(())
}
