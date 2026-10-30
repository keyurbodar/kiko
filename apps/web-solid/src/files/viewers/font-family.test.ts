import { describe, expect, it } from "vitest"
import { sfntFamily } from "./font-family"

function font(family: string): Uint8Array {
  const encoded = new Uint8Array(family.length * 2)
  enc(family, encoded)
  const name = new Uint8Array(6 + 12 + encoded.length)
  const view = new DataView(name.buffer)
  view.setUint16(2, 1)
  view.setUint16(4, 18)
  view.setUint16(6, 3)
  view.setUint16(8, 1)
  view.setUint16(10, 0x409)
  view.setUint16(12, 1)
  view.setUint16(14, encoded.length)
  name.set(encoded, 18)
  const header = new Uint8Array(12 + 16 + name.length)
  const head = new DataView(header.buffer)
  head.setUint32(0, 0x00010000)
  head.setUint16(4, 1)
  head.setUint32(12, 0x6e616d65)
  head.setUint32(20, 28)
  head.setUint32(24, name.length)
  header.set(name, 28)
  return header
}

function enc(value: string, into: Uint8Array): void {
  for (let index = 0; index < value.length; index++) into[index * 2 + 1] = value.charCodeAt(index)
}

describe("sfntFamily", () => {
  it("reads the family name from a TrueType name table", () => {
    expect(sfntFamily(font("Inter"))).toBe("Inter")
  })

  it("returns nothing for bytes that are not a font", () => {
    expect(sfntFamily(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(sfntFamily(new TextEncoder().encode("not a font"))).toBeNull()
  })
})
