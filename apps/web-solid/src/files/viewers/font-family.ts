const u16 = (view: DataView, at: number) => view.getUint16(at)
const u32 = (view: DataView, at: number) => view.getUint32(at)

export function sfntFamily(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = u32(view, 0)
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) return null
  const tables = u16(view, 4)
  let nameOffset = -1
  let nameLength = 0
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16
    if (record + 16 > bytes.length) return null
    const tag = String.fromCharCode(bytes[record]!, bytes[record + 1]!, bytes[record + 2]!, bytes[record + 3]!)
    if (tag !== "name") continue
    nameOffset = u32(view, record + 8)
    nameLength = u32(view, record + 12)
  }
  if (nameOffset < 0 || nameOffset + nameLength > bytes.length || nameLength < 6) return null
  const count = u16(view, nameOffset + 2)
  const strings = nameOffset + u16(view, nameOffset + 4)
  const found = new Map<number, string>()
  for (let index = 0; index < count; index++) {
    const record = nameOffset + 6 + index * 12
    if (record + 12 > nameOffset + nameLength) break
    const platform = u16(view, record)
    const nameId = u16(view, record + 6)
    const length = u16(view, record + 8)
    const offset = strings + u16(view, record + 10)
    if (offset + length > bytes.length) continue
    if (platform !== 0 && platform !== 3) continue
    if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue
    const decoded = new TextDecoder("utf-16be").decode(bytes.subarray(offset, offset + length))
    if (decoded.trim()) found.set(nameId, decoded.trim())
  }
  return found.get(16) ?? found.get(1) ?? found.get(4) ?? null
}
