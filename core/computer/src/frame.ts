export const FRAME_HEADER = 14
export const NO_CURSOR = 0xffff

const BINARY = 2
const LENGTH = 4

export type FrameKind = "jpeg" | "webp"

export type FrameHeader = {
  kind: FrameKind
  width: number
  height: number
  seq: number
  cursor: { x: number; y: number } | null
}

const KINDS: readonly FrameKind[] = ["jpeg", "webp"]

function pack(header: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(header.byteLength + data.byteLength)
  out.set(header, 0)
  out.set(data, header.byteLength)
  return out
}

function split(bytes: Uint8Array, headerLength: number): { header: Uint8Array; data: Uint8Array } | null {
  if (bytes.byteLength < headerLength) return null
  return { header: bytes.subarray(0, headerLength), data: bytes.subarray(headerLength) }
}

export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = new Uint8Array(FRAME_HEADER)
  const view = new DataView(head.buffer)
  view.setUint8(0, 1)
  view.setUint8(1, KINDS.indexOf(header.kind) + 1)
  view.setUint16(2, header.width, true)
  view.setUint16(4, header.height, true)
  view.setUint32(6, header.seq >>> 0, true)
  view.setUint16(10, header.cursor ? Math.round(header.cursor.x * 0xfffe) : NO_CURSOR, true)
  view.setUint16(12, header.cursor ? Math.round(header.cursor.y * 0xfffe) : NO_CURSOR, true)
  return pack(head, image)
}

export function decodeFrame(bytes: Uint8Array): { header: FrameHeader; image: Uint8Array } | null {
  const parts = split(bytes, FRAME_HEADER)
  if (!parts || parts.data.byteLength === 0) return null
  const view = new DataView(parts.header.buffer, parts.header.byteOffset, parts.header.byteLength)
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
    image: parts.data,
  }
}

export const IMAGE_REF = "$bin"

export type ImagePart = { mime: string; length: number }

type BinaryMessage = { header: Record<string, unknown>; data: Uint8Array }

export function encodeBinary(header: Record<string, unknown>, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const head = new Uint8Array(1 + LENGTH + json.byteLength)
  const view = new DataView(head.buffer)
  view.setUint8(0, BINARY)
  view.setUint32(1, json.byteLength, true)
  head.set(json, 1 + LENGTH)
  return pack(head, data)
}

export function decodeBinary(bytes: Uint8Array): BinaryMessage | null {
  const parts = split(bytes, 1 + LENGTH)
  if (!parts || parts.header[0] !== BINARY) return null
  const view = new DataView(parts.header.buffer, parts.header.byteOffset, parts.header.byteLength)
  const length = view.getUint32(1, true)
  if (length > parts.data.byteLength) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(parts.data.subarray(0, length)))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  return { header: parsed as Record<string, unknown>, data: parts.data.subarray(length) }
}
