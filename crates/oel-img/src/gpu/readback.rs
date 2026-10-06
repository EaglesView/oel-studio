//! Copies an RGBA8 target into a mappable buffer and reads it back, natively by polling the
//! device, in the browser by awaiting the map callback.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

pub struct Readback {
    buf: wgpu::Buffer,
    w: u32,
    h: u32,
    row: u32,
}

impl Readback {
    pub fn new(device: &wgpu::Device, enc: &mut wgpu::CommandEncoder, target: &wgpu::Texture, (w, h): (u32, u32)) -> Self {
        let row = (w * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("oel-img readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        enc.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buf,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        Self { buf, w, h, row }
    }

    pub async fn read(self, device: &wgpu::Device) -> Result<Vec<u8>, String> {
        let slot = Arc::new(Mutex::new(Slot::default()));
        let s2 = slot.clone();
        self.buf.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let mut s = s2.lock().unwrap();
            s.result = Some(r.map_err(|e| e.to_string()));
            if let Some(w) = s.waker.take() {
                w.wake();
            }
        });
        #[cfg(not(target_arch = "wasm32"))]
        device.poll(wgpu::PollType::wait_indefinitely()).map_err(|e| e.to_string())?;
        // WebGL2 maps only when polled, and its fences signal only after the event loop runs:
        // poll, yield a macrotask, repeat. (WebGPU resolves on its own; the poll is a no-op.)
        #[cfg(target_arch = "wasm32")]
        while slot.lock().unwrap().result.is_none() {
            let _ = device.poll(wgpu::PollType::Poll);
            if slot.lock().unwrap().result.is_some() {
                break;
            }
            next_task().await;
        }
        Mapped(slot).await?;
        let data = self.buf.slice(..).get_mapped_range().map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity((self.w * self.h * 4) as usize);
        for y in 0..self.h as usize {
            let start = y * self.row as usize;
            out.extend_from_slice(&data[start..start + self.w as usize * 4]);
        }
        drop(data);
        self.buf.unmap();
        Ok(out)
    }
}

#[derive(Default)]
struct Slot {
    result: Option<Result<(), String>>,
    waker: Option<Waker>,
}

struct Mapped(Arc<Mutex<Slot>>);

impl Future for Mapped {
    type Output = Result<(), String>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut s = self.0.lock().unwrap();
        match s.result.take() {
            Some(r) => Poll::Ready(r.map_err(|e| format!("Lecture du rendu impossible : {e}"))),
            None => {
                s.waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// Resolves on the next macrotask (`setTimeout(0)`), in a window or a worker.
#[cfg(target_arch = "wasm32")]
async fn next_task() {
    use wasm_bindgen::{JsCast, JsValue};
    let p = js_sys::Promise::new(&mut |resolve, _| {
        let global = js_sys::global();
        if let Ok(f) = js_sys::Reflect::get(&global, &JsValue::from_str("setTimeout")) {
            let _ = f.unchecked_into::<js_sys::Function>().call2(&global, &resolve, &JsValue::from(0));
        }
    });
    let _ = wasm_bindgen_futures::JsFuture::from(p).await;
}
