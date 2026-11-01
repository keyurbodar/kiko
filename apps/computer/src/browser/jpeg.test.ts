import { describe, expect, it } from "vitest"
import { jpegSize } from "./jpeg"

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0])
  bytes[7] = height >> 8
  bytes[8] = height & 0xff
  bytes[9] = width >> 8
  bytes[10] = width & 0xff
  return bytes
}

describe("jpeg size", () => {
  it("reads the frame size a screencast produced", () => {
    expect(jpegSize(jpeg(1280, 800))).toEqual({ width: 1280, height: 800 })
    expect(jpegSize(jpeg(8, 5))).toEqual({ width: 8, height: 5 })
  })

  it("says nothing for bytes that are not a jpeg", () => {
    expect(jpegSize(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(jpegSize(new Uint8Array())).toBeNull()
  })
})
