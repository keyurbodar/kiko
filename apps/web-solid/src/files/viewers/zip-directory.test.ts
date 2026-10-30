import { describe, expect, it } from "vitest"
import { readZipDirectory } from "./zip-directory"

const encoder = new TextEncoder()

function zip(files: Record<string, string>): ArrayBuffer {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = encoder.encode(text)
    const nameBytes = encoder.encode(name)
    const local = new Uint8Array(30 + nameBytes.length + raw.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint32(18, raw.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(raw, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(12, 0x6000, true)
    cv.setUint16(14, 0x5a21, true)
    cv.setUint32(20, raw.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const size = centrals.reduce((total, central) => total + central.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out.buffer
}

describe("readZipDirectory", () => {
  it("lists names, sizes, dates and folders from the central directory", () => {
    const entries = readZipDirectory(zip({ "trip/": "", "trip/plan.md": "# Plan", "trip/budget.csv": "a,b\n1,2\n" }))
    expect(entries.map((entry) => [entry.name, entry.size, entry.directory])).toEqual([
      ["trip/", 0, true],
      ["trip/plan.md", 6, false],
      ["trip/budget.csv", 8, false],
    ])
    expect(entries[1]!.modified).toBe(new Date(2025, 0, 1, 12, 0, 0).getTime())
  })

  it("rejects bytes that are not a zip", () => {
    expect(() => readZipDirectory(encoder.encode("not a zip").buffer as ArrayBuffer)).toThrow(
      "This is not a readable ZIP archive.",
    )
  })

  it("rejects an archive with more entries than the preview allows", () => {
    expect(() => readZipDirectory(zip({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }), 2)).toThrow(
      "This archive contains more than 2,048 entries.",
    )
  })
})
