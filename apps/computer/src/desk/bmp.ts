const FILE_HEADER = 14
const INFO_HEADER = 40
const PIXEL_OFFSET = FILE_HEADER + INFO_HEADER

export function bitmapInfoHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(INFO_HEADER)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, INFO_HEADER, true)
  view.setInt32(4, width, true)
  view.setInt32(8, -height, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, 32, true)
  view.setUint32(16, 0, true)
  view.setUint32(20, width * height * 4, true)
  return bytes
}

export function bmpFromBgra(
  pixels: Uint8Array,
  width: number,
  height: number,
  stride: number,
): Uint8Array<ArrayBuffer> {
  const row = width * 4
  const imageSize = row * height
  const bytes = new Uint8Array(PIXEL_OFFSET + imageSize)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, PIXEL_OFFSET, true)
  bytes.set(bitmapInfoHeader(width, height), FILE_HEADER)
  for (let y = 0; y < height; y++) {
    const from = y * stride
    bytes.set(pixels.subarray(from, from + row), PIXEL_OFFSET + y * row)
  }
  for (let index = PIXEL_OFFSET + 3; index < bytes.length; index += 4) bytes[index] = 0
  return bytes
}
