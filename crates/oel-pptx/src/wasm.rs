//! wasm-bindgen surface used by the `@oel/engine` worker (web build) and by
//! `apps/collab` + vitest (nodejs build). Bytes / JSON strings in and out.

use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn imported_to_js(imp: crate::Imported) -> Result<JsValue, JsError> {
    let out = js_sys::Object::new();
    let json = serde_json::to_string(&imp.deck).map_err(js_err)?;
    let set = |o: &js_sys::Object, k: &str, v: &JsValue| js_sys::Reflect::set(o, &k.into(), v).map(|_| ()).map_err(|_| js_err("objet JS"));
    set(&out, "json", &JsValue::from_str(&json))?;
    let media = js_sys::Array::new();
    for m in imp.media {
        let o = js_sys::Object::new();
        set(&o, "path", &JsValue::from_str(&m.path))?;
        set(&o, "mime", &JsValue::from_str(&m.mime))?;
        set(&o, "bytes", &js_sys::Uint8Array::from(m.bytes.as_slice()).into())?;
        media.push(&o);
    }
    set(&out, "media", &media.into())?;
    Ok(out.into())
}

/// Read a .pptx. Returns `{ json: string, media: {path, mime, bytes}[] }`.
#[wasm_bindgen]
pub fn pptx_to_deck(bytes: &[u8]) -> Result<JsValue, JsError> {
    imported_to_js(crate::import_pptx(bytes).map_err(js_err)?)
}

/// A new presentation, same shape as `pptx_to_deck`.
#[wasm_bindgen]
pub fn new_deck() -> Result<JsValue, JsError> {
    imported_to_js(crate::new_deck())
}

/// Write deck JSON back to .pptx. `original` is the imported file (kept parts are
/// copied byte for byte); `media` is `{path, bytes}[]` for pictures added in the editor.
#[wasm_bindgen]
pub fn deck_to_pptx(json: &str, original: Option<Vec<u8>>, media: js_sys::Array) -> Result<Vec<u8>, JsError> {
    let deck: crate::Deck = serde_json::from_str(json).map_err(|e| js_err(format!("présentation JSON invalide : {e}")))?;
    let mut map = std::collections::HashMap::new();
    for item in media.iter() {
        let path = js_sys::Reflect::get(&item, &"path".into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let bytes = js_sys::Reflect::get(&item, &"bytes".into()).map(|v| js_sys::Uint8Array::new(&v).to_vec()).unwrap_or_default();
        if !path.is_empty() {
            map.insert(path, bytes);
        }
    }
    crate::export_pptx(&deck, original.as_deref(), map).map_err(js_err)
}
