export type HexRow = { offset: string; hex: string; ascii: string }

const PRINTABLE = (byte: number) => byte >= 0x20 && byte <= 0x7e

export function hexRow(bytes: Uint8Array, offset: number, perRow = 16): HexRow {
  let hex = ""
  let ascii = ""
  for (let index = 0; index < perRow; index++) {
    const byte = bytes[offset + index]
    hex += byte === undefined ? "  " : byte.toString(16).padStart(2, "0")
    ascii += byte === undefined ? " " : PRINTABLE(byte) ? String.fromCharCode(byte) : "."
    if (index < perRow - 1) hex += " "
  }
  return { offset: offset.toString(16).padStart(8, "0"), hex, ascii }
}

export function hexRowCount(size: number, perRow = 16): number {
  return Math.ceil(size / perRow)
}
