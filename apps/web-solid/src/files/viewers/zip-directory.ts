export type ZipEntry = { name: string; size: number; modified: number | null; directory: boolean }

type Bounds = { start: number; end: number }

function bounds(bytes: ArrayBuffer, entryLimit: number): Bounds {
  const view = new DataView(bytes)
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue
    if (offset + 22 + view.getUint16(offset + 20, true) !== bytes.byteLength)
      throw new Error("This is not a readable ZIP archive.")
    const count = view.getUint16(offset + 10, true)
    const size = view.getUint32(offset + 12, true)
    const start = view.getUint32(offset + 16, true)
    if (
      [4, 6, 8, 10].some((field) => view.getUint16(offset + field, true) === 0xffff) ||
      size === 0xffffffff ||
      start === 0xffffffff
    )
      throw new Error("Unsupported ZIP64 archive.")
    if (count > entryLimit) throw new Error("This archive contains more than 2,048 entries.")
    if (start > offset - size) throw new Error("This ZIP directory is damaged.")
    return { start: offset - size, end: offset }
  }
  throw new Error("This is not a readable ZIP archive.")
}

function modifiedAt(date: number, time: number): number | null {
  if (!date) return null
  const year = ((date >> 9) & 0x7f) + 1980
  const month = (date >> 5) & 0x0f
  const day = date & 0x1f
  const hours = (time >> 11) & 0x1f
  const minutes = (time >> 5) & 0x3f
  const seconds = (time & 0x1f) * 2
  const value = new Date(year, Math.max(0, month - 1), Math.max(1, day), hours, minutes, seconds)
  return Number.isNaN(value.getTime()) ? null : value.getTime()
}

export function readZipDirectory(bytes: ArrayBuffer, entryLimit = 2048): ZipEntry[] {
  const view = new DataView(bytes)
  const { start, end } = bounds(bytes, entryLimit)
  const names = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let offset = start; offset < end;) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("This ZIP directory is damaged.")
    if (entries.length >= entryLimit) throw new Error("This archive contains more than 2,048 entries.")
    const nameLength = view.getUint16(offset + 28, true)
    if (nameLength > 1024) throw new Error("An archive path is too long to preview.")
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = names.decode(new Uint8Array(bytes, offset + 46, nameLength))
    entries.push({
      name,
      size: view.getUint32(offset + 24, true),
      modified: modifiedAt(view.getUint16(offset + 14, true), view.getUint16(offset + 12, true)),
      directory: name.endsWith("/"),
    })
    offset += 46 + nameLength + extraLength + commentLength
    if (offset > end) throw new Error("This ZIP directory is damaged.")
  }
  return entries
}
