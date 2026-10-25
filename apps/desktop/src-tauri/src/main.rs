//! Desktop shell: serves `apps/web/dist` in a native webview, starting on the Bureau.
//! Everything else (engines, desk, storage) is the web front end as it is (plan 2026-10-desktop, D1, D2).

// No console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("the desktop app could not start");
}
