// oel-img GPU passes. Mirrors src/cpu/pipeline.rs and src/cpu/blur.rs line for line: change
// both together (tests/gpu_parity.rs holds them to ±2/255). Render passes only, textureLoad
// only (no filtering, no storage), so the same module runs on WebGPU, WebGL2 and native.

struct Params {
    m_in: array<vec4<f32>, 3>,
    m_out: array<vec4<f32>, 3>,
    // Intermediate images are stored in linear sRGB primaries (f16 keeps near-zero channels
    // exact; Rec.2020 storage loses them to cancellation in the output matrix).
    m_load: array<vec4<f32>, 3>,
    m_store: array<vec4<f32>, 3>,
    // shadows, highlights, contrast, whites (−1…1)
    tone: vec4<f32>,
    // blacks, long edge (px), scale, _
    tone2: vec4<f32>,
    // has_shadows_highlights, has_contrast_whites_blacks, has_curve, has_hsl
    flags: vec4<f32>,
    // has_grading, has_texture_clarity, has_dehaze, has_vibrance_saturation
    flags2: vec4<f32>,
    hsl_hue: array<vec4<f32>, 2>,
    hsl_sat: array<vec4<f32>, 2>,
    hsl_lum: array<vec4<f32>, 2>,
    // wheel offsets (shadows, midtones, highlights), rgb
    grade_off: array<vec4<f32>, 3>,
    // blending, balance (0…1 / −1…1)
    grade: vec4<f32>,
    // texture, clarity, dehaze, vibrance (−1…1)
    presence: vec4<f32>,
    // saturation, _, _, _
    presence2: vec4<f32>,
    // noise luma, noise color (0…1), sharpen amount (0…1.5), sharpen detail (0…1)
    detail: vec4<f32>,
    // sharpen masking threshold t, _, _, _
    detail2: vec4<f32>,
    // vignette amount (−1…1), start, width, roundness (−100…100)
    vignette: vec4<f32>,
    // grain amount, size, roughness (0…100), _
    grain: vec4<f32>,
    // crop x0, y0 (normalised), sin, cos
    geom: vec4<f32>,
    // flip_h, flip_v, output w, output h
    geom2: vec4<f32>,
};

struct Pass {
    // x: mode, y: kernel radius, z: split (scalar plane kept as f16 value + residual), w: unused
    mode: vec4<f32>,
    // source w, h; destination w, h
    size: vec4<f32>,
    k: array<vec4<f32>, 10>,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> S: Pass;
@group(0) @binding(2) var t0: texture_2d<f32>;
@group(0) @binding(3) var t1: texture_2d<f32>;
@group(0) @binding(4) var t2: texture_2d<f32>;
@group(0) @binding(5) var t3: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

// ── Shared maths (src/color.rs) ────────────────────────────────────────────────────────────

const LUMA = vec3<f32>(0.2627, 0.6780, 0.0593);
const PI = 3.14159265358979;

fn luma(c: vec3<f32>) -> f32 { return dot(c, LUMA); }

fn spow(x: f32, p: f32) -> f32 {
    let a = abs(x);
    return select(0.0, sign(x) * pow(a, p), a > 0.0);
}
fn encode(x: f32) -> f32 { return spow(x, 1.0 / 2.2); }
fn decode(x: f32) -> f32 { return spow(x, 2.2); }
fn encode3(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(encode(c.r), encode(c.g), encode(c.b)); }
fn decode3(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(decode(c.r), decode(c.g), decode(c.b)); }

fn srgb_eotf(v: f32) -> f32 {
    return select(pow((v + 0.055) / 1.055, 2.4), v / 12.92, v <= 0.04045);
}
fn srgb_oetf(l: f32) -> f32 {
    return select(1.055 * spow(l, 1.0 / 2.4) - 0.055, l * 12.92, l <= 0.0031308);
}

fn sstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn rem(x: f32, m: f32) -> f32 { return x - floor(x / m) * m; }

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let d = mx - mn;
    if (d <= 0.0 || mx <= 0.0) { return vec3<f32>(0.0, 0.0, mx); }
    var h: f32;
    if (mx == c.r) { h = (c.g - c.b) / d; }
    else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
    else { h = (c.r - c.g) / d + 4.0; }
    return vec3<f32>(rem(h * 60.0, 360.0), d / mx, mx);
}

fn hsv_f(n: f32, h: f32, s: f32, v: f32) -> f32 {
    let k = rem(n + rem(h, 360.0) / 60.0, 6.0);
    return v - v * s * clamp(min(k, 4.0 - k), 0.0, 1.0);
}
fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(hsv_f(5.0, c.x, c.y, c.z), hsv_f(3.0, c.x, c.y, c.z), hsv_f(1.0, c.x, c.y, c.z));
}

fn mat_in(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(P.m_in[0].xyz, c), dot(P.m_in[1].xyz, c), dot(P.m_in[2].xyz, c));
}
fn mat_out(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(P.m_out[0].xyz, c), dot(P.m_out[1].xyz, c), dot(P.m_out[2].xyz, c));
}

/// Scales `c` so its luminance becomes `y2`; black becomes neutral grey (cpu set_luma).
fn set_luma(c: vec3<f32>, y2: f32) -> vec3<f32> {
    let y = luma(c);
    if (y > 1e-6) { return c * (y2 / y); }
    return vec3<f32>(y2);
}

fn ld(t: texture_2d<f32>, p: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(t));
    return textureLoad(t, clamp(p, vec2<i32>(0), d - 1), 0);
}

/// Reads an intermediate image into the working space.
fn img(t: texture_2d<f32>, p: vec2<i32>) -> vec4<f32> {
    let c = ld(t, p);
    let w = vec3<f32>(dot(P.m_load[0].xyz, c.rgb), dot(P.m_load[1].xyz, c.rgb), dot(P.m_load[2].xyz, c.rgb));
    return vec4<f32>(w, c.a);
}

/// Writes a working-space colour to an intermediate image.
fn put(c: vec3<f32>, a: f32) -> vec4<f32> {
    return vec4<f32>(dot(P.m_store[0].xyz, c), dot(P.m_store[1].xyz, c), dot(P.m_store[2].xyz, c), a);
}

fn px(pos: vec4<f32>) -> vec2<i32> { return vec2<i32>(floor(pos.xy)); }

// Scalar planes are RG16F: r = value rounded to f16, g = what the rounding lost. Blurs re-split
// their sums, so planes keep ~22 bits (dehaze divides by them).
// `hi` keeps 11 significant bits (f16's precision) so the f16 store is exact; plain bit
// rounding instead of quantizeToF16, which needs a capability some backends lack.
fn split(v: f32) -> vec4<f32> {
    let hi = bitcast<f32>((bitcast<u32>(v) + 0x1000u) & 0xffffe000u);
    return vec4<f32>(hi, v - hi, 0.0, 0.0);
}
fn resplit(v: vec4<f32>) -> vec4<f32> {
    return select(v, split(v.r + v.g), S.mode.z > 0.0);
}
fn plane(t: texture_2d<f32>, p: vec2<i32>) -> f32 {
    let v = ld(t, p);
    return v.r + v.g;
}

// ── Input: sRGB 8-bit → working (white balance + exposure in m_in) ────────────────────────

@fragment
fn fs_input(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = ld(t0, px(pos));
    let lin = vec3<f32>(srgb_eotf(c.r), srgb_eotf(c.g), srgb_eotf(c.b));
    return put(mat_in(lin), c.a);
}

// ── Planes for the blurs ───────────────────────────────────────────────────────────────────

@fragment
fn fs_extract(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = img(t0, px(pos)).rgb;
    let mode = i32(S.mode.x);
    if (mode == 0) { return split(max(luma(c), 0.0)); }
    if (mode == 1) { return split(encode(max(luma(c), 0.0))); }
    if (mode == 2) { return split(min(encode(max(min(c.r, min(c.g, c.b)), 0.0)), 1.0)); }
    let e = encode3(c);
    return vec4<f32>(e - vec3<f32>(luma(e)), 0.0);
}

// ── Blur (src/cpu/blur.rs) ─────────────────────────────────────────────────────────────────

@fragment
fn fs_down(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let s = px(pos) * 2;
    return resplit((ld(t0, s) + ld(t0, s + vec2<i32>(1, 0)) + ld(t0, s + vec2<i32>(0, 1)) + ld(t0, s + vec2<i32>(1, 1))) * 0.25);
}

fn tap(i: i32) -> f32 { return S.k[i / 4][i % 4]; }

@fragment
fn fs_blur(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let r = i32(S.mode.y);
    let dir = select(vec2<i32>(0, 1), vec2<i32>(1, 0), S.mode.x == 0.0);
    var acc = vec4<f32>(0.0);
    for (var i = 0; i <= 2 * r; i++) {
        acc += tap(i) * ld(t0, p + dir * (i - r));
    }
    return resplit(acc);
}

@fragment
fn fs_up(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let f = S.size.xy / S.size.zw;
    let s = (floor(pos.xy) + 0.5) * f - 0.5;
    let b = floor(s);
    let t = s - b;
    let i = vec2<i32>(b);
    let top = ld(t0, i) * (1.0 - t.x) + ld(t0, i + vec2<i32>(1, 0)) * t.x;
    let bot = ld(t0, i + vec2<i32>(0, 1)) * (1.0 - t.x) + ld(t0, i + vec2<i32>(1, 1)) * t.x;
    return resplit(top * (1.0 - t.y) + bot * t.y);
}

// ── Tone ───────────────────────────────────────────────────────────────────────────────────

fn tone_curve(l: f32, ct: f32, wv: f32, bv: f32) -> f32 {
    let lc = min(l, 1.0);
    var t = lc + 0.15 * ct * sin(2.0 * PI * (lc - 0.5));
    t += 0.2 * wv * pow(clamp(t, 0.0, 1.0), 4.0);
    t += 0.2 * bv * pow(1.0 - clamp(t, 0.0, 1.0), 4.0);
    return t + (l - lc);
}

@fragment
fn fs_tone(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let src = img(t0, p);
    var c = src.rgb;
    if (P.flags.x > 0.0) {
        let lb = min(encode(max(plane(t1, p), 0.0)), 1.0);
        let ws = 1.0 - sstep(0.0, 0.6, lb);
        let wh = sstep(0.4, 1.0, lb);
        c *= exp2(1.5 * (P.tone.x * ws + P.tone.y * wh));
    }
    if (P.flags.y > 0.0) {
        let l = encode(max(luma(c), 0.0));
        c = set_luma(c, decode(max(tone_curve(l, P.tone.z, P.tone.w, P.tone2.x), 0.0)));
    }
    return put(c, src.a);
}

// ── Colour: curves, HSL mixer, grading ─────────────────────────────────────────────────────

fn lut(ch: i32, x: f32) -> f32 {
    let n = f32(textureDimensions(t2).x);
    let p = clamp(x, 0.0, 1.0) * (n - 1.0);
    let i = min(floor(p), n - 2.0);
    let t = p - i;
    let a = textureLoad(t2, vec2<i32>(i32(i), ch), 0).r;
    let b = textureLoad(t2, vec2<i32>(i32(i) + 1, ch), 0).r;
    return a + (b - a) * t;
}

const CENTERS = array<f32, 9>(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);

fn band(v: array<vec4<f32>, 2>, i: i32) -> f32 { return v[i / 4][i % 4]; }

fn hsl_mixer(c: vec3<f32>) -> vec3<f32> {
    let e = encode3(max(c, vec3<f32>(0.0)));
    let hsv = rgb_to_hsv(e);
    if (hsv.y <= 0.0) { return c; }
    let h = rem(hsv.x, 360.0);
    var dh = 0.0;
    var ds = 0.0;
    var dl = 0.0;
    for (var i = 0; i < 8; i++) {
        if (h >= CENTERS[i] && h < CENTERS[i + 1]) {
            let t = (h - CENTERS[i]) / (CENTERS[i + 1] - CENTERS[i]);
            let j = (i + 1) % 8;
            dh = (1.0 - t) * band(P.hsl_hue, i) + t * band(P.hsl_hue, j);
            ds = (1.0 - t) * band(P.hsl_sat, i) + t * band(P.hsl_sat, j);
            dl = (1.0 - t) * band(P.hsl_lum, i) + t * band(P.hsl_lum, j);
        }
    }
    let e2 = hsv_to_rgb(vec3<f32>(hsv.x + dh * 30.0, clamp(hsv.y * (1.0 + ds), 0.0, 1.0), hsv.z));
    return decode3(e2) * exp2(dl * hsv.y);
}

fn grading(c: vec3<f32>) -> vec3<f32> {
    let l = min(encode(max(luma(c), 0.0)), 1.0);
    let lo = 0.25 - 0.15 * P.grade.y;
    let hi = 0.75 - 0.15 * P.grade.y;
    let width = 0.05 + 0.45 * P.grade.x;
    let ws = 1.0 - sstep(lo - width, lo + width, l);
    let wh = sstep(hi - width, hi + width, l);
    let wm = max(1.0 - ws - wh, 0.0);
    let e = encode3(c) + ws * P.grade_off[0].rgb + wm * P.grade_off[1].rgb + wh * P.grade_off[2].rgb;
    return decode3(e);
}

@fragment
fn fs_color(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let src = img(t0, px(pos));
    var c = src.rgb;
    if (P.flags.z > 0.0) {
        let e = encode3(max(c, vec3<f32>(0.0)));
        c = vec3<f32>(decode(lut(0, e.r)), decode(lut(1, e.g)), decode(lut(2, e.b)));
    }
    if (P.flags.w > 0.0) { c = hsl_mixer(c); }
    if (P.flags2.x > 0.0) { c = grading(c); }
    return put(c, src.a);
}

// ── Presence ───────────────────────────────────────────────────────────────────────────────

// t1: texture base (or unused), t2: clarity base (or unused)
@fragment
fn fs_texture_clarity(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let src = img(t0, p);
    let l = encode(max(luma(src.rgb), 0.0));
    let m = max(1.0 - pow(2.0 * min(l, 1.0) - 1.0, 2.0), 0.0);
    var l2 = l;
    if (P.presence.x != 0.0) { l2 += P.presence.x * (l - plane(t1, p)); }
    if (P.presence.y != 0.0) { l2 += 0.8 * P.presence.y * m * (l - plane(t2, p)); }
    return put(set_luma(src.rgb, decode(max(l2, 0.0))), src.a);
}

// t1: blurred dark channel (dehaze > 0)
@fragment
fn fs_dehaze_vibrance(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let src = img(t0, p);
    var c = src.rgb;
    let d = P.presence.z;
    if (P.flags2.z > 0.0) {
        if (d > 0.0) {
            let t = max(1.0 - 0.95 * d * plane(t1, p), 0.1);
            let e = (encode3(c) - 1.0) / t + 1.0;
            c = decode3(max(e, vec3<f32>(0.0)));
        } else {
            c = decode3(mix(encode3(c), vec3<f32>(0.85), -d * 0.5));
        }
    }
    if (P.flags2.w > 0.0) {
        let e = encode3(max(c, vec3<f32>(0.0)));
        let l = luma(e);
        let hsv = rgb_to_hsv(e);
        let skin = max(1.0 - abs(hsv.x - 25.0) / 25.0, 0.0);
        let f = max((1.0 + P.presence2.x) * (1.0 + P.presence.w * (1.0 - hsv.y) * (1.0 - 0.5 * skin)), 0.0);
        c = decode3(vec3<f32>(l) + (e - vec3<f32>(l)) * f);
    }
    return put(c, src.a);
}

// ── Detail ─────────────────────────────────────────────────────────────────────────────────

// mode 0: luma noise (t1 = blurred encoded luma); mode 1: colour noise (t1 = blurred chroma)
@fragment
fn fs_noise(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let src = img(t0, p);
    if (S.mode.x == 0.0) {
        let nl = P.detail.x;
        let l = encode(max(luma(src.rgb), 0.0));
        let b = plane(t1, p);
        let r = 0.02 + 0.08 * nl;
        let k = exp(-((l - b) * (l - b)) / (2.0 * r * r));
        let amt = min(2.0 * nl, 1.0);
        return put(set_luma(src.rgb, decode(max(l + (b - l) * k * amt, 0.0))), src.a);
    }
    let e = encode3(src.rgb);
    let l = luma(e);
    let ch = mix(e - vec3<f32>(l), ld(t1, p).rgb, P.detail.y);
    return put(decode3(vec3<f32>(l) + ch), src.a);
}

// t1: blurred encoded luma
@fragment
fn fs_sharpen(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = px(pos);
    let src = img(t0, p);
    let t = P.detail2.x;
    var m = 1.0;
    if (t > 0.0) {
        let gx = plane(t1, p + vec2<i32>(1, 0)) - plane(t1, p - vec2<i32>(1, 0));
        let gy = plane(t1, p + vec2<i32>(0, 1)) - plane(t1, p - vec2<i32>(0, 1));
        m = sstep(0.5 * t, t, 0.5 * sqrt(gx * gx + gy * gy));
    }
    let l = encode(max(luma(src.rgb), 0.0));
    let lim = 0.02 + 0.3 * P.detail.w;
    let hf = clamp(l - plane(t1, p), -lim, lim);
    return put(set_luma(src.rgb, decode(max(l + P.detail.z * hf * m, 0.0))), src.a);
}

// ── Final: geometry, vignette, grain, output ───────────────────────────────────────────────

fn pcg(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn lattice(x: i32, y: i32, seed: u32) -> f32 {
    let h = pcg(bitcast<u32>(x) ^ pcg(bitcast<u32>(y) + seed * 0x9e3779b9u));
    return f32(h) / 4294967295.0 - 0.5;
}

fn value_noise(p: vec2<f32>, seed: u32) -> f32 {
    let f = floor(p);
    let t = p - f;
    let s = t * t * (3.0 - 2.0 * t);
    let x = i32(f.x);
    let y = i32(f.y);
    let a = mix(lattice(x, y, seed), lattice(x + 1, y, seed), s.x);
    let b = mix(lattice(x, y + 1, seed), lattice(x + 1, y + 1, seed), s.x);
    return mix(a, b, s.y);
}

fn grain_noise(p: vec2<f32>) -> f32 {
    let cell = 1.0 + P.grain.y / 100.0 * 3.0;
    let q = p / cell;
    return mix(value_noise(q, 0u), value_noise(q * 2.0, 1u), P.grain.z / 100.0);
}

@fragment
fn fs_final(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let dim = vec2<f32>(textureDimensions(t0));
    let o = floor(pos.xy);
    let pp = P.geom.xy * dim + o + 0.5;
    let d = pp - dim / 2.0;
    var s = dim / 2.0 + vec2<f32>(P.geom.w * d.x - P.geom.z * d.y, P.geom.z * d.x + P.geom.w * d.y);
    if (P.geom2.x > 0.0) { s.x = dim.x - s.x; }
    if (P.geom2.y > 0.0) { s.y = dim.y - s.y; }
    var q = s - 0.5;
    if (q.x < -0.5 || q.y < -0.5 || q.x > dim.x - 0.5 || q.y > dim.y - 0.5) { return vec4<f32>(0.0); }
    q = clamp(q, vec2<f32>(0.0), dim - 1.0);
    let b = floor(q);
    let t = q - b;
    let i = vec2<i32>(b);
    let top = ld(t0, i) * (1.0 - t.x) + ld(t0, i + vec2<i32>(1, 0)) * t.x;
    let bot = ld(t0, i + vec2<i32>(0, 1)) * (1.0 - t.x) + ld(t0, i + vec2<i32>(1, 1)) * t.x;
    let src = top * (1.0 - t.y) + bot * t.y;
    var c = vec3<f32>(dot(P.m_load[0].xyz, src.rgb), dot(P.m_load[1].xyz, src.rgb), dot(P.m_load[2].xyz, src.rgb));

    let osz = P.geom2.zw;
    if (P.vignette.x != 0.0) {
        let u = (o + 0.5) / osz * 2.0 - 1.0;
        let ar = osz.x / osz.y;
        let ell = length(u);
        let cir = length(vec2<f32>(u.x * ar, u.y)) / max(ar, 1.0);
        let dist = mix(ell, cir, (P.vignette.w / 100.0 + 1.0) / 2.0);
        let f = sstep(P.vignette.y, P.vignette.y + P.vignette.z, dist) * P.vignette.x;
        c = select(mix(c, vec3<f32>(1.0), f), c * (1.0 + f), f < 0.0);
    }
    if (P.grain.x > 0.0) {
        let n = grain_noise(pp / P.tone2.z) * P.grain.x / 100.0 * 0.12;
        c = decode3(encode3(c) + n);
    }
    let out = clamp(mat_out(c), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(srgb_oetf(out.r), srgb_oetf(out.g), srgb_oetf(out.b), src.a);
}
