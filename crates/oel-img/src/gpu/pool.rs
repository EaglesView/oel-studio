//! Intermediate textures, reused across passes and frames. A texture released mid-frame may be
//! taken again by a later pass of the same frame: commands run in order, so that is safe.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tex(usize);

struct Item {
    tex: wgpu::Texture,
    w: u32,
    h: u32,
    format: wgpu::TextureFormat,
    free: bool,
}

#[derive(Default)]
pub struct Pool {
    items: Vec<Item>,
}

impl Pool {
    pub fn take(&mut self, device: &wgpu::Device, w: u32, h: u32, format: wgpu::TextureFormat) -> Tex {
        if let Some(i) = self.items.iter().position(|t| t.free && t.w == w && t.h == h && t.format == format) {
            self.items[i].free = false;
            return Tex(i);
        }
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("oel-img intermediate"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        self.items.push(Item { tex, w, h, format, free: false });
        Tex(self.items.len() - 1)
    }

    pub fn get(&self, t: Tex) -> &wgpu::Texture {
        &self.items[t.0].tex
    }

    pub fn dims(&self, t: Tex) -> (u32, u32, wgpu::TextureFormat) {
        let i = &self.items[t.0];
        (i.w, i.h, i.format)
    }

    pub fn release(&mut self, t: Tex) {
        self.items[t.0].free = true;
    }

    pub fn release_all(&mut self) {
        for i in &mut self.items {
            i.free = true;
        }
    }

    /// Drops every texture (new source size).
    pub fn clear(&mut self) {
        self.items.clear();
    }
}
