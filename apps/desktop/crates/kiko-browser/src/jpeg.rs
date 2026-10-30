pub fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut at = 2;
    while at + 9 < bytes.len() {
        if bytes[at] != 0xFF {
            at += 1;
            continue;
        }
        let marker = bytes[at + 1];
        if marker == 0x01 || (0xD0..=0xD9).contains(&marker) {
            at += 2;
            continue;
        }
        let length = usize::from(bytes[at + 2]) << 8 | usize::from(bytes[at + 3]);
        let sized = (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if sized {
            let height = u32::from(bytes[at + 5]) << 8 | u32::from(bytes[at + 6]);
            let width = u32::from(bytes[at + 7]) << 8 | u32::from(bytes[at + 8]);
            return Some((width, height));
        }
        at += 2 + length;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(marker: u8, width: u16, height: u16) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, marker, 0x00, 0x11, 0x08];
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    #[test]
    fn reads_the_sof_size() {
        assert_eq!(dimensions(&header(0xC0, 640, 480)), Some((640, 480)));
        assert_eq!(dimensions(&header(0xC2, 1280, 720)), Some((1280, 720)));
    }

    #[test]
    fn skips_a_leading_app_segment() {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
        bytes.extend(header(0xC0, 320, 200));
        assert_eq!(dimensions(&bytes), Some((320, 200)));
    }

    #[test]
    fn rejects_something_that_is_not_a_jpeg() {
        assert_eq!(dimensions(b"not a jpeg at all"), None);
        assert_eq!(dimensions(&[]), None);
    }
}
