import { describe, expect, it } from "@effect/vitest"
import { xImageFields } from "./ximage"

type Fields = { width: number; height: number; data: bigint; stride: number; bits: number }

function struct(fields: Fields): DataView {
  const view = new DataView(new ArrayBuffer(56))
  view.setInt32(0, fields.width, true)
  view.setInt32(4, fields.height, true)
  view.setBigUint64(16, fields.data, true)
  view.setInt32(44, fields.stride, true)
  view.setInt32(48, fields.bits, true)
  return view
}

describe("xImageFields", () => {
  it("reads the LP64 XImage layout", () => {
    const view = struct({ width: 1920, height: 1080, data: 0x7f1234567890n, stride: 7680, bits: 32 })
    expect(xImageFields(view)).toEqual({
      width: 1920,
      height: 1080,
      data: 0x7f1234567890,
      stride: 7680,
      bitsPerPixel: 32,
    })
  })

  it("ignores the fields the capture does not use", () => {
    const view = struct({ width: 3, height: 2, data: 0n, stride: 12, bits: 24 })
    view.setInt32(12, 2, true)
    view.setInt32(40, 24, true)
    expect(xImageFields(view)).toEqual({ width: 3, height: 2, data: 0, stride: 12, bitsPerPixel: 24 })
  })
})
