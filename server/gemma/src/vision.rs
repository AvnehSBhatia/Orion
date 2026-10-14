//! Image preprocessing, ported from Transformers.js `Gemma4ImageProcessor` as it runs under Node:
//! sharp decode (EXIF auto-rotate) -> RGB (alpha dropped) -> aspect-preserving resize through libvips
//! `affine` with the bicubic interpolator -> rescale 1/255 -> 16x16 patches padded to max_patches.

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use image::{DynamicImage, ImageDecoder, ImageReader, RgbImage};
use std::io::Cursor;
use std::sync::OnceLock;

pub const PATCH_SIZE: usize = 16;
pub const POOLING_KERNEL: usize = 3;
pub const RESCALE: f64 = 0.00392156862745098;

/// What the vision encoder takes for one image.
pub struct Patches {
    /// [max_patches, 16*16*3], zero padded.
    pub pixel_values: Vec<f32>,
    /// [max_patches, 2] as (col, row), -1 padded.
    pub positions: Vec<i64>,
    pub max_patches: usize,
    pub num_soft_tokens: usize,
}

/// Base64 (optionally a data: URI) to an upright RGB image.
pub fn decode_b64(b64: &str) -> Result<RgbImage> {
    let s = b64.trim();
    let s = match s.strip_prefix("data:") {
        Some(rest) => rest.split_once(',').map(|(_, d)| d).unwrap_or(rest),
        None => s,
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(s.trim_end_matches('=').as_bytes()))
        .context("invalid base64 image")?;
    decode_bytes(&bytes)
}

pub fn decode_bytes(bytes: &[u8]) -> Result<RgbImage> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()
        .context("unsupported image format")?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).context("image decode failed")?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img.to_rgb8())
}

/// `get_aspect_ratio_preserving_size`: target (height, width), multiples of pooling_kernel * patch_size.
pub fn target_size(height: usize, width: usize, max_patches: usize) -> Result<(usize, usize)> {
    let (h, w) = (height as f64, width as f64);
    let target_px = (max_patches * PATCH_SIZE * PATCH_SIZE) as f64;
    let factor = (target_px / (h * w)).sqrt();
    let side = (POOLING_KERNEL * PATCH_SIZE) as f64;
    let mut th = ((factor * h) / side).floor() * side;
    let mut tw = ((factor * w) / side).floor() * side;
    if th == 0.0 && tw == 0.0 {
        bail!("Attempting to resize to a 0 x 0 image");
    }
    let max_side = (max_patches as f64 / (POOLING_KERNEL * POOLING_KERNEL) as f64).floor() * side;
    if th == 0.0 {
        th = side;
        tw = ((w / h).floor() * side).min(max_side);
    } else if tw == 0.0 {
        tw = side;
        th = ((h / w).floor() * side).min(max_side);
    }
    Ok((th as usize, tw as usize))
}

const SUBPIXELS: usize = 64; // VIPS_TRANSFORM_SCALE
const ISHIFT: i32 = 12; // VIPS_INTERPOLATE_SHIFT

/// libvips `vips_bicubic_matrixi`: Catmull-Rom weights at 64 subpixel offsets, 12-bit fixed point.
fn bicubic_table() -> &'static [[i32; 4]; SUBPIXELS + 1] {
    static TAB: OnceLock<[[i32; 4]; SUBPIXELS + 1]> = OnceLock::new();
    TAB.get_or_init(|| {
        let mut t = [[0i32; 4]; SUBPIXELS + 1];
        for (i, row) in t.iter_mut().enumerate() {
            let x = i as f64 / SUBPIXELS as f64;
            let dx = 1.0 - x;
            let x2 = dx * x;
            let mx2 = -0.5 * x2;
            let c0 = mx2 * dx;
            let c1 = x2 * (-1.5 * x + 1.0) + dx;
            let c3 = mx2 * x;
            let c2 = 1.0 - (c0 + c1 + c3);
            for (k, c) in [c0, c1, c2, c3].into_iter().enumerate() {
                // rint: round half to even
                row[k] = (c * (1 << ISHIFT) as f64).round_ties_even() as i32;
            }
        }
        t
    })
}

/// sharp `.affine([tw/w, 0, 0, th/h], { interpolator: "bicubic" })` on uchar RGB: inverse-mapped corner convention
/// (output pixel X samples input x = X * w/tw, no half-pixel shift), black outside the image, 12-bit fixed point
/// with rounding after each pass. Matches sharp 0.35 / libvips 8.18 to within 1 LSB on ~1% of pixels.
pub fn vips_affine_bicubic(src: &RgbImage, tw: usize, th: usize) -> RgbImage {
    let (w, h) = (src.width() as usize, src.height() as usize);
    let tab = bicubic_table();
    let data = src.as_raw();
    // The forward matrix is computed in JS as tw / w; libvips inverts it.
    let ia = 1.0 / (tw as f64 / w as f64);
    let id = 1.0 / (th as f64 / h as f64);
    let px = |x: isize, y: isize, c: usize| -> i32 {
        if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
            0
        } else {
            data[(y as usize * w + x as usize) * 3 + c] as i32
        }
    };
    let round = |v: i32| (v + (1 << (ISHIFT - 1))) >> ISHIFT;
    let mut out = vec![0u8; tw * th * 3];
    for oy in 0..th {
        let y = oy as f64 * id;
        let iy = y.floor();
        let ty = (((y - iy) * (SUBPIXELS * 2) as f64) as usize + 1) >> 1;
        let cy = tab[ty];
        let iy = iy as isize;
        for ox in 0..tw {
            let x = ox as f64 * ia;
            let ix = x.floor();
            let tx = (((x - ix) * (SUBPIXELS * 2) as f64) as usize + 1) >> 1;
            let cx = tab[tx];
            let ix = ix as isize;
            for c in 0..3 {
                let mut acc = 0i32;
                for (j, wy) in cy.iter().enumerate() {
                    let yy = iy - 1 + j as isize;
                    let mut row = 0i32;
                    for (i, wx) in cx.iter().enumerate() {
                        row += wx * px(ix - 1 + i as isize, yy, c);
                    }
                    acc += wy * round(row);
                }
                out[(oy * tw + ox) * 3 + c] = round(acc).clamp(0, 255) as u8;
            }
        }
    }
    RgbImage::from_raw(tw as u32, th as u32, out).expect("buffer size")
}

/// The full image processor for one image.
pub fn preprocess(img: &RgbImage, max_soft_tokens: usize) -> Result<Patches> {
    let max_patches = max_soft_tokens * POOLING_KERNEL * POOLING_KERNEL;
    let (h, w) = (img.height() as usize, img.width() as usize);
    if h == 0 || w == 0 {
        return Err(anyhow!("empty image"));
    }
    let (th, tw) = target_size(h, w, max_patches)?;
    let resized;
    let img = if th != h || tw != w {
        resized = vips_affine_bicubic(img, tw, th);
        &resized
    } else {
        img
    };
    let (h, w) = (img.height() as usize, img.width() as usize);
    let data = img.as_raw();
    let (ph, pw) = (h / PATCH_SIZE, w / PATCH_SIZE);
    let num_patches = ph * pw;
    if num_patches > max_patches {
        bail!("image has {num_patches} patches, more than {max_patches}");
    }
    let patch_dim = PATCH_SIZE * PATCH_SIZE * 3;
    let mut pixel_values = vec![0f32; max_patches * patch_dim];
    let mut out = 0;
    for py in 0..ph {
        for px in 0..pw {
            for dy in 0..PATCH_SIZE {
                let row = ((py * PATCH_SIZE + dy) * w + px * PATCH_SIZE) * 3;
                for v in &data[row..row + PATCH_SIZE * 3] {
                    pixel_values[out] = (*v as f64 * RESCALE) as f32;
                    out += 1;
                }
            }
        }
    }
    let mut positions = vec![-1i64; max_patches * 2];
    let mut i = 0;
    for row in 0..ph {
        for col in 0..pw {
            positions[i] = col as i64;
            positions[i + 1] = row as i64;
            i += 2;
        }
    }
    Ok(Patches { pixel_values, positions, max_patches, num_soft_tokens: num_patches / (POOLING_KERNEL * POOLING_KERNEL) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_sizes() {
        assert_eq!(target_size(800, 1280, 2520).unwrap(), (624, 1008));
        assert_eq!(target_size(1080, 1920, 2520).unwrap(), (576, 1056));
        assert_eq!(target_size(30, 50, 2520).unwrap(), (576, 1008));
        // Very wide: zero height branch
        assert_eq!(target_size(10, 4000, 2520).unwrap().0, 48);
    }
}
