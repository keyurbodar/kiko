const WIDTH = 0
const HEIGHT = 4
const DATA = 16
const BYTES_PER_LINE = 44
const BITS_PER_PIXEL = 48

export const IMAGE_FIELDS = 56

export type ImageFields = {
  width: number
  height: number
  stride: number
  bitsPerPixel: number
  data: number
}

export function xImageFields(view: DataView): ImageFields {
  return {
    width: view.getInt32(WIDTH, true),
    height: view.getInt32(HEIGHT, true),
    data: Number(view.getBigUint64(DATA, true)),
    stride: view.getInt32(BYTES_PER_LINE, true),
    bitsPerPixel: view.getInt32(BITS_PER_PIXEL, true),
  }
}
