//! Desktop shell: serves `apps/web/dist` in a native webview, starting on the Bureau.
//! Everything else (engines, desk, storage) is the web front end as it is (plan 2026-10-desktop, D1, D2).

// No console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("the desktop app could not start");
}
