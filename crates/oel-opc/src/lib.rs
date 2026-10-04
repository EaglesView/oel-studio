//! Lossless OOXML plumbing shared by the OutilsEnLigne codecs.
//!
//! - [`xml`]: a small XML DOM that keeps everything it does not understand verbatim.
//! - [`package`]: the OPC container (zip parts, relationships, content types),
//!   written back with untouched parts byte for byte.
//! - [`color`]: DrawingML colours and their transforms, resolved to CSS.
//! - [`fonts`]: open substitutes for Office fonts, embedded-font de-obfuscation.

pub mod color;
pub mod fonts;
pub mod package;
pub mod xml;
