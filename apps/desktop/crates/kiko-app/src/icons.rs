use std::io::Cursor;

pub const TRAY_TEMPLATE: &[u8] = include_bytes!("../resources/tray-template.png");
pub const TRAY_COLOR: &[u8] = include_bytes!("../resources/tray.png");

pub fn rgba(png: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let mut reader = png::Decoder::new(Cursor::new(png)).read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buffer).ok()?;
    let bytes = &buffer[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => bytes.to_vec(),
        png::ColorType::Rgb => bytes
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|px| [px[0], px[1], px[2], 255])
            .collect(),
        _ => return None,
    };
    Some((rgba, info.width, info.height))
}

#[cfg(target_os = "linux")]
pub fn pixmap(png: &[u8]) -> Vec<ksni::Icon> {
    let Some((rgba, width, height)) = rgba(png) else {
        return Vec::new();
    };
    let data = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|px| [px[3], px[0], px[1], px[2]])
        .collect();
    vec![ksni::Icon {
        width: width as i32,
        height: height as i32,
        data,
    }]
}
