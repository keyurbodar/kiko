use base64::Engine as _;
use image::ExtendedColorType;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use kiko_driver::{DriverError, Image};
use x11rb::connection::Connection as _;
use x11rb::protocol::composite::ConnectionExt as _;
use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat};

use crate::error::failed;
use crate::x11::X11;

const QUALITY: u8 = 82;

pub(crate) fn capture(x11: &mut X11, xid: u32, max_width: u32) -> Result<Image, DriverError> {
    let rect = x11
        .rect(xid)
        .ok_or_else(|| failed("the window has no geometry"))?;
    let (width, height) = (rect.w as u16, rect.h as u16);
    if width == 0 || height == 0 {
        return Err(failed("the window has no size"));
    }
    x11.ensure_composite().map_err(failed)?;
    let (drawable, offset_x, offset_y) = x11
        .top_ancestor(xid)
        .ok_or_else(|| failed("the window is not in the window tree"))?;
    let (offset_x, offset_y) = (
        u16::try_from(offset_x).map_err(|_| failed("the window sits outside its frame"))?,
        u16::try_from(offset_y).map_err(|_| failed("the window sits outside its frame"))?,
    );
    let frame = x11
        .rect(drawable)
        .ok_or_else(|| failed("the frame has no geometry"))?;
    if u32::from(offset_x) + u32::from(width) > frame.w as u32
        || u32::from(offset_y) + u32::from(height) > frame.h as u32
    {
        return Err(failed("the window sits outside its frame"));
    }
    let conn = x11.connection();
    let pixmap = conn
        .generate_id()
        .map_err(|error| failed(format!("could not allocate a pixmap: {error}")))?;
    conn.composite_name_window_pixmap(drawable, pixmap)
        .map_err(|error| failed(format!("could not name the window pixmap: {error}")))?
        .check()
        .map_err(|error| failed(format!("could not read the window's pixels: {error}")))?;
    let reply = conn
        .get_image(
            ImageFormat::Z_PIXMAP,
            pixmap,
            offset_x as i16,
            offset_y as i16,
            width,
            height,
            !0,
        )
        .map_err(|error| failed(format!("could not read the window's pixels: {error}")));
    let freed = conn
        .free_pixmap(pixmap)
        .map_err(|error| failed(format!("could not free the pixmap: {error}")))
        .and_then(|cookie| {
            cookie
                .check()
                .map_err(|error| failed(format!("could not free the pixmap: {error}")))
        });
    let reply = reply?
        .reply()
        .map_err(|error| failed(format!("could not read the window's pixels: {error}")))?;
    freed?;
    let (bits, pad) = x11
        .pixmap_format(reply.depth)
        .ok_or_else(|| failed(format!("unsupported pixel depth {}", reply.depth)))?;
    let rgb = to_rgb(
        &reply.data,
        u32::from(width),
        u32::from(height),
        bits,
        pad,
        reply.depth,
    )?;
    let (rgb, out_width, out_height) = scale(rgb, u32::from(width), u32::from(height), max_width);
    let mut encoded = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded, QUALITY)
        .encode(rgb.as_raw(), out_width, out_height, ExtendedColorType::Rgb8)
        .map_err(|error| failed(format!("could not encode the image: {error}")))?;
    Ok(Image {
        mime: "image/jpeg".to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(&encoded),
        width: out_width,
        height: out_height,
        covers: rect,
    })
}

fn to_rgb(
    data: &[u8],
    width: u32,
    height: u32,
    bits: u8,
    pad: u8,
    depth: u8,
) -> Result<image::RgbImage, DriverError> {
    if bits != 32 {
        return Err(failed(format!("unsupported {bits}-bit pixels")));
    }
    let stride =
        ((width * u32::from(bits) + u32::from(pad) - 1) / u32::from(pad)) * u32::from(pad) / 8;
    let needed = (stride * height) as usize;
    if data.len() < needed {
        return Err(failed("the X server returned a short image"));
    }
    let opaque = depth != 32;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for row in data.chunks_exact(stride as usize).take(height as usize) {
        for pixel in row.as_chunks::<4>().0 {
            let (blue, green, red, alpha) = (pixel[0], pixel[1], pixel[2], pixel[3]);
            if opaque {
                rgb.extend_from_slice(&[red, green, blue]);
            } else {
                let remaining = 255 - u16::from(alpha);
                rgb.extend_from_slice(&[
                    (u16::from(red) + remaining).min(255) as u8,
                    (u16::from(green) + remaining).min(255) as u8,
                    (u16::from(blue) + remaining).min(255) as u8,
                ]);
            }
        }
    }
    image::RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| failed("the image is the wrong size"))
}

fn scale(
    rgb: image::RgbImage,
    width: u32,
    height: u32,
    max_width: u32,
) -> (image::RgbImage, u32, u32) {
    if max_width == 0 || width <= max_width {
        return (rgb, width, height);
    }
    let scaled_height =
        ((u64::from(height) * u64::from(max_width)) / u64::from(width)).max(1) as u32;
    (
        image::imageops::resize(&rgb, max_width, scaled_height, FilterType::Triangle),
        max_width,
        scaled_height,
    )
}

#[cfg(test)]
mod tests {
    use super::{scale, to_rgb};

    #[test]
    fn reads_bgrx_rows() {
        let data = [0x10, 0x20, 0x30, 0x00, 0x40, 0x50, 0x60, 0x00];
        let image = to_rgb(&data, 2, 1, 32, 32, 24).unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [0x30, 0x20, 0x10]);
        assert_eq!(image.get_pixel(1, 0).0, [0x60, 0x50, 0x40]);
    }

    #[test]
    fn blends_transparent_pixels_onto_white() {
        let image = to_rgb(&[0x00, 0x00, 0x00, 0x00], 1, 1, 32, 32, 32).unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn rejects_short_buffers() {
        assert!(to_rgb(&[0, 0, 0, 0], 2, 1, 32, 32, 24).is_err());
    }

    #[test]
    fn scales_down_to_the_max_width() {
        let image = image::RgbImage::new(400, 300);
        let (scaled, width, height) = scale(image, 400, 300, 200);
        assert_eq!((width, height), (200, 150));
        assert_eq!(scaled.dimensions(), (200, 150));
    }
}
