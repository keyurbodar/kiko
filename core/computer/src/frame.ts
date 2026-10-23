export const FRAME_HEADER = 14
export const NO_CURSOR = 0xffff

export type FrameKind = "jpeg" | "webp"

export type FrameHeader = {
  kind: FrameKind
  width: number
  height: number
  seq: number
  cursor: { x: number; y: number } | null
}

const KINDS: readonly FrameKind[] = ["jpeg", "webp"]

export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(FRAME_HEADER + image.byteLength)
  const view = new DataView(out.buffer)
  view.setUint8(0, 1)
  view.setUint8(1, KINDS.indexOf(header.kind) + 1)
  view.setUint16(2, header.width, true)
  view.setUint16(4, header.height, true)
  view.setUint32(6, header.seq >>> 0, true)
  view.setUint16(10, header.cursor ? Math.round(header.cursor.x * 0xfffe) : NO_CURSOR, true)
  view.setUint16(12, header.cursor ? Math.round(header.cursor.y * 0xfffe) : NO_CURSOR, true)
  out.set(image, FRAME_HEADER)
  return out
}

export function decodeFrame(bytes: Uint8Array): { header: FrameHeader; image: Uint8Array } | null {
  if (bytes.byteLength <= FRAME_HEADER) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kind = KINDS[view.getUint8(1) - 1]
  if (view.getUint8(0) !== 1 || !kind) return null
  const cx = view.getUint16(10, true)
  const cy = view.getUint16(12, true)
  return {
    header: {
      kind,
      width: view.getUint16(2, true),
      height: view.getUint16(4, true),
      seq: view.getUint32(6, true),
      cursor: cx === NO_CURSOR || cy === NO_CURSOR ? null : { x: cx / 0xfffe, y: cy / 0xfffe },
    },
    image: bytes.subarray(FRAME_HEADER),
  }
}
