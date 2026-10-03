//! wasm-bindgen surface used by the `@oel/engine` worker (web build) and by
//! `apps/collab` + vitest (nodejs build). Bytes / JSON strings in and out.

use wasm_bindgen::prelude::*;

fn err_js(msg: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&msg.to_string())
}

fn imported_to_js(imp: crate::Imported) -> Result<JsValue, JsValue> {
    let out = js_sys::Object::new();
    let json = serde_json::to_string(&imp.json).map_err(err_js)?;
    js_sys::Reflect::set(&out, &"json".into(), &JsValue::from_str(&json))?;
    let media = js_sys::Array::new();
    for m in imp.media {
        let o = js_sys::Object::new();
        js_sys::Reflect::set(&o, &"path".into(), &JsValue::from_str(&m.path))?;
        js_sys::Reflect::set(&o, &"mime".into(), &JsValue::from_str(&m.mime))?;
        js_sys::Reflect::set(&o, &"bytes".into(), &js_sys::Uint8Array::from(m.bytes.as_slice()))?;
        media.push(&o);
    }
    js_sys::Reflect::set(&out, &"media".into(), &media)?;
    Ok(out.into())
}

/// Parse a .docx into editor JSON. Returns `{ json: string, media: {path, mime, bytes}[] }`.
#[wasm_bindgen]
pub fn docx_to_pm(bytes: &[u8]) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();
    imported_to_js(crate::import_docx(bytes).map_err(err_js)?)
}

/// Editor JSON for a new, empty document (built-in styles), same shape as `docx_to_pm`.
#[wasm_bindgen]
pub fn new_document_pm() -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();
    imported_to_js(crate::new_document())
}

/// Write editor JSON back to .docx. `original` is the imported file (kept parts
/// are copied byte for byte); `media` is `{path, bytes}[]` for images added in the editor.
#[wasm_bindgen]
pub fn pm_to_docx(json: &str, original: Option<Vec<u8>>, media: js_sys::Array) -> Result<Vec<u8>, JsValue> {
    console_error_panic_hook::set_once();
    let value: serde_json::Value = serde_json::from_str(json).map_err(err_js)?;
    let mut map = std::collections::HashMap::new();
    for item in media.iter() {
        let path = js_sys::Reflect::get(&item, &"path".into())?.as_string().unwrap_or_default();
        let bytes = js_sys::Uint8Array::new(&js_sys::Reflect::get(&item, &"bytes".into())?).to_vec();
        if !path.is_empty() {
            map.insert(path, bytes);
        }
    }
    crate::export_docx(&value, original.as_deref(), map).map_err(err_js)
}
