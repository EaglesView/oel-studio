//! `oel-img-recipe@1`: the non-destructive edit applied to an original image.
//!
//! A recipe is a **layer**: every leaf is optional, so the effective settings of an image are
//! `image overrides ⊕ gallery style ⊕ defaults`, field by field ([`Recipe::over`], then
//! [`Recipe::resolve`] → [`Settings`]). In Yjs a recipe is one `Y.Map` with one key per leaf,
//! named by its path in [`FIELDS`] (`presence.clarity`, `hsl.red.hue`…).
//!
//! Units follow Lightroom-style sliders: most controls are −100…100 with 0 neutral; exposure is
//! in EV; temperature in kelvins relative to 6500 K (higher = warmer). [`FIELDS`] is the single
//! table of paths, ranges and defaults (exported to TypeScript by `npm run gen:types`).

use serde::{Deserialize, Serialize};

/// Value of the `format` key when a recipe is stored outside Yjs (custom parts, exports).
pub const RECIPE_FORMAT: &str = "oel-img-recipe@1";

/// A recipe layer whose leaves are all unset is omitted when serialised.
pub trait Layer {
    fn is_empty(&self) -> bool;
}

fn is_empty_layer<T: Layer>(t: &T) -> bool {
    t.is_empty()
}

/// Declares a recipe group twice: the layer (`$layer`, every leaf `Option`) and its resolved
/// settings (`$name`, plain values with defaults). Sub-groups after `;` nest the same way.
macro_rules! group {
    (
        $(#[$m:meta])*
        $name:ident / $layer:ident {
            $( $(#[$fm:meta])* $f:ident : $t:ty = $d:expr, )*
            $( ; $( $(#[$gm:meta])* $g:ident : $gn:ident / $gl:ident, )* )?
        }
    ) => {
        $(#[$m])*
        #[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelimg/", optional_fields))]
        #[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", default)]
        pub struct $layer {
            $( $(#[$fm])* #[serde(skip_serializing_if = "Option::is_none")] pub $f: Option<$t>, )*
            $( $(
                $(#[$gm])*
                #[serde(skip_serializing_if = "is_empty_layer")]
                #[cfg_attr(feature = "ts", ts(as = "Option<_>", optional))]
                pub $g: $gl,
            )* )?
        }

        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Serialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            $( pub $f: $t, )*
            $( $( pub $g: $gn, )* )?
        }

        impl Default for $name {
            fn default() -> Self {
                Self { $( $f: $d, )* $( $( $g: $gn::default(), )* )? }
            }
        }

        impl Layer for $layer {
            fn is_empty(&self) -> bool {
                true $( && self.$f.is_none() )* $( $( && self.$g.is_empty() )* )?
            }
        }

        impl $layer {
            /// This layer on top of `base`: each leaf set here wins.
            pub fn over(&self, base: &Self) -> Self {
                Self {
                    $( $f: self.$f.clone().or_else(|| base.$f.clone()), )*
                    $( $( $g: self.$g.over(&base.$g), )* )?
                }
            }

            /// Fills unset leaves with their defaults.
            pub fn resolve(&self) -> $name {
                #[allow(unused_variables)]
                let d = $name::default();
                $name {
                    $( $f: self.$f.clone().unwrap_or(d.$f), )*
                    $( $( $g: self.$g.resolve(), )* )?
                }
            }
        }
    };
}

group! {
    /// White balance relative to 6500 K: the scene light is assumed to be `temp_k` / `tint` and
    /// is corrected to neutral, so a higher temperature warms the image, a positive tint adds magenta.
    WhiteBalanceSettings / WhiteBalance {
        temp_k: f32 = 6500.0,
        tint: f32 = 0.0,
    }
}

group! {
    PresenceSettings / Presence {
        texture: f32 = 0.0,
        clarity: f32 = 0.0,
        dehaze: f32 = 0.0,
        vibrance: f32 = 0.0,
        saturation: f32 = 0.0,
    }
}

group! {
    /// Tone curves as control points `[x, y]` in 0…1 (display-encoded), interpolated with a
    /// monotone cubic. `rgb` applies first, then each channel's own curve.
    ToneCurveSettings / ToneCurve {
        rgb: Vec<[f32; 2]> = identity_curve(),
        r: Vec<[f32; 2]> = identity_curve(),
        g: Vec<[f32; 2]> = identity_curve(),
        b: Vec<[f32; 2]> = identity_curve(),
    }
}

group! {
    HslBandSettings / HslBand {
        hue: f32 = 0.0,
        sat: f32 = 0.0,
        lum: f32 = 0.0,
    }
}

group! {
    /// HSL mixer: eight hue bands.
    HslSettings / Hsl {
        ;
        red: HslBandSettings / HslBand,
        orange: HslBandSettings / HslBand,
        yellow: HslBandSettings / HslBand,
        green: HslBandSettings / HslBand,
        aqua: HslBandSettings / HslBand,
        blue: HslBandSettings / HslBand,
        purple: HslBandSettings / HslBand,
        magenta: HslBandSettings / HslBand,
    }
}

group! {
    /// One colour-grading wheel: hue in degrees, saturation 0…100, luminance −100…100.
    WheelSettings / Wheel {
        hue: f32 = 0.0,
        sat: f32 = 0.0,
        lum: f32 = 0.0,
    }
}

group! {
    GradingSettings / Grading {
        blending: f32 = 50.0,
        balance: f32 = 0.0,
        ;
        shadows: WheelSettings / Wheel,
        midtones: WheelSettings / Wheel,
        highlights: WheelSettings / Wheel,
    }
}

group! {
    SharpenSettings / Sharpen {
        amount: f32 = 0.0,
        /// Pixels at full resolution.
        radius: f32 = 1.0,
        detail: f32 = 25.0,
        masking: f32 = 0.0,
    }
}

group! {
    NoiseSettings / Noise {
        luma: f32 = 0.0,
        color: f32 = 0.0,
    }
}

group! {
    DetailSettings / Detail {
        ;
        sharpen: SharpenSettings / Sharpen,
        noise: NoiseSettings / Noise,
    }
}

group! {
    VignetteSettings / Vignette {
        amount: f32 = 0.0,
        midpoint: f32 = 50.0,
        roundness: f32 = 0.0,
        feather: f32 = 50.0,
    }
}

group! {
    GrainSettings / Grain {
        amount: f32 = 0.0,
        size: f32 = 25.0,
        roughness: f32 = 50.0,
    }
}

group! {
    EffectsSettings / Effects {
        ;
        vignette: VignetteSettings / Vignette,
        grain: GrainSettings / Grain,
    }
}

group! {
    /// Crop rectangle `[x0, y0, x1, y1]` normalised to the upright image, straightening angle in
    /// degrees (positive = counter-clockwise), flips, and the aspect the crop tool keeps
    /// (`original`, `libre` or `W:H`; the renderer ignores it).
    GeometrySettings / Geometry {
        crop: [f32; 4] = [0.0, 0.0, 1.0, 1.0],
        angle: f32 = 0.0,
        flip_h: bool = false,
        flip_v: bool = false,
        aspect: String = "original".to_string(),
    }
}

group! {
    /// One recipe layer (`oel-img-recipe@1`).
    Settings / Recipe {
        /// [`RECIPE_FORMAT`] when stored outside Yjs.
        format: String = RECIPE_FORMAT.to_string(),
        exposure: f32 = 0.0,
        contrast: f32 = 0.0,
        highlights: f32 = 0.0,
        shadows: f32 = 0.0,
        whites: f32 = 0.0,
        blacks: f32 = 0.0,
        ;
        white_balance: WhiteBalanceSettings / WhiteBalance,
        presence: PresenceSettings / Presence,
        tone_curve: ToneCurveSettings / ToneCurve,
        hsl: HslSettings / Hsl,
        grading: GradingSettings / Grading,
        detail: DetailSettings / Detail,
        effects: EffectsSettings / Effects,
        geometry: GeometrySettings / Geometry,
    }
}

pub fn identity_curve() -> Vec<[f32; 2]> {
    vec![[0.0, 0.0], [1.0, 1.0]]
}

impl Recipe {
    /// Effective layer for a stack ordered from most specific (image overrides) to most general
    /// (gallery style).
    pub fn stack<'a>(layers: impl IntoIterator<Item = &'a Recipe>) -> Recipe {
        layers.into_iter().fold(None::<Recipe>, |acc, l| Some(match acc {
            None => l.clone(),
            Some(top) => top.over(l),
        })).unwrap_or_default()
    }

    pub fn from_json(json: &str) -> Result<Recipe, String> {
        let r: Recipe = serde_json::from_str(json).map_err(|e| format!("Recette d’image illisible : {e}"))?;
        match r.format.as_deref() {
            None | Some(RECIPE_FORMAT) => Ok(r),
            Some(other) => Err(format!("Format de recette inconnu : {other}")),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("recipe serialises")
    }
}

/// How a leaf is edited in the atelier.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelimg/"))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    Slider,
    Toggle,
    Curve,
    Rect,
    Choice,
}

/// One leaf of the recipe: its Yjs key / JSON path, its control and, for sliders, range and default.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "oelimg/"))]
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpec {
    pub path: String,
    pub kind: FieldKind,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub step: f32,
}

fn slider(path: impl Into<String>, min: f32, max: f32, default: f32, step: f32) -> FieldSpec {
    FieldSpec { path: path.into(), kind: FieldKind::Slider, min, max, default, step }
}
fn pm100(path: impl Into<String>) -> FieldSpec {
    slider(path, -100.0, 100.0, 0.0, 1.0)
}
fn other(path: &str, kind: FieldKind) -> FieldSpec {
    FieldSpec { path: path.into(), kind, min: 0.0, max: 0.0, default: 0.0, step: 0.0 }
}

const BANDS: [&str; 8] = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const WHEELS: [&str; 3] = ["shadows", "midtones", "highlights"];

/// Every recipe leaf, in atelier order.
pub fn fields() -> Vec<FieldSpec> {
    let mut f = vec![
        slider("whiteBalance.tempK", 2000.0, 50000.0, 6500.0, 50.0),
        slider("whiteBalance.tint", -150.0, 150.0, 0.0, 1.0),
        slider("exposure", -5.0, 5.0, 0.0, 0.01),
        pm100("contrast"),
        pm100("highlights"),
        pm100("shadows"),
        pm100("whites"),
        pm100("blacks"),
        pm100("presence.texture"),
        pm100("presence.clarity"),
        pm100("presence.dehaze"),
        pm100("presence.vibrance"),
        pm100("presence.saturation"),
        other("toneCurve.rgb", FieldKind::Curve),
        other("toneCurve.r", FieldKind::Curve),
        other("toneCurve.g", FieldKind::Curve),
        other("toneCurve.b", FieldKind::Curve),
    ];
    for b in BANDS {
        for k in ["hue", "sat", "lum"] {
            f.push(pm100(format!("hsl.{b}.{k}")));
        }
    }
    for w in WHEELS {
        f.push(slider(format!("grading.{w}.hue"), 0.0, 360.0, 0.0, 1.0));
        f.push(slider(format!("grading.{w}.sat"), 0.0, 100.0, 0.0, 1.0));
        f.push(pm100(format!("grading.{w}.lum")));
    }
    f.extend([
        slider("grading.blending", 0.0, 100.0, 50.0, 1.0),
        pm100("grading.balance"),
        slider("detail.sharpen.amount", 0.0, 150.0, 0.0, 1.0),
        slider("detail.sharpen.radius", 0.5, 3.0, 1.0, 0.1),
        slider("detail.sharpen.detail", 0.0, 100.0, 25.0, 1.0),
        slider("detail.sharpen.masking", 0.0, 100.0, 0.0, 1.0),
        slider("detail.noise.luma", 0.0, 100.0, 0.0, 1.0),
        slider("detail.noise.color", 0.0, 100.0, 0.0, 1.0),
        pm100("effects.vignette.amount"),
        slider("effects.vignette.midpoint", 0.0, 100.0, 50.0, 1.0),
        pm100("effects.vignette.roundness"),
        slider("effects.vignette.feather", 0.0, 100.0, 50.0, 1.0),
        slider("effects.grain.amount", 0.0, 100.0, 0.0, 1.0),
        slider("effects.grain.size", 0.0, 100.0, 25.0, 1.0),
        slider("effects.grain.roughness", 0.0, 100.0, 50.0, 1.0),
        other("geometry.crop", FieldKind::Rect),
        slider("geometry.angle", -45.0, 45.0, 0.0, 0.1),
        other("geometry.flipH", FieldKind::Toggle),
        other("geometry.flipV", FieldKind::Toggle),
        other("geometry.aspect", FieldKind::Choice),
    ]);
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes `oelimg/fields.ts` next to the ts-rs bindings (`npm run gen:types` runs every
    /// `export_bindings*` test).
    #[cfg(feature = "ts")]
    #[test]
    fn export_bindings_fields() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/engine/src/generated/oelimg");
        std::fs::create_dir_all(&dir).unwrap();
        let json = serde_json::to_string_pretty(&fields()).unwrap();
        let ts = format!(
            "// Generated by crates/oel-img (recipe.rs FIELDS). Do not edit.\nimport type {{ FieldSpec }} from './FieldSpec';\n\nexport const RECIPE_FORMAT = '{RECIPE_FORMAT}';\n\nexport const RECIPE_FIELDS: readonly FieldSpec[] = {json};\n"
        );
        std::fs::write(dir.join("fields.ts"), ts).unwrap();
    }

    #[test]
    fn field_paths_are_unique() {
        let f = fields();
        let mut paths: Vec<_> = f.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), f.len());
    }

    /// Slider defaults in the table agree with `Settings::default()`, and every path exists.
    #[test]
    fn field_defaults_match_settings() {
        let d = serde_json::to_value(Settings::default()).unwrap();
        for f in fields() {
            let v = f.path.split('.').fold(&d, |v, k| &v[k]);
            assert!(!v.is_null(), "{} missing from Settings", f.path);
            if f.kind == FieldKind::Slider {
                assert_eq!(v.as_f64().unwrap() as f32, f.default, "{}", f.path);
                assert!(f.min <= f.default && f.default <= f.max, "{}", f.path);
            }
        }
    }
}
