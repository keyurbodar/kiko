import { describe, expect, it } from "vitest"
import { decodeBinary, decodeFrame, encodeBinary, encodeFrame, IMAGE_REF } from "./frame"

describe("live frames", () => {
  it("still round trips a jpeg with its cursor", () => {
    const image = new Uint8Array([1, 2, 3, 4])
    const bytes = encodeFrame({ kind: "jpeg", width: 1280, height: 720, seq: 7, cursor: { x: 0.5, y: 0.5 } }, image)

    const decoded = decodeFrame(bytes)

    expect(decoded?.header).toEqual({
      kind: "jpeg",
      width: 1280,
      height: 720,
      seq: 7,
      cursor: { x: 0.5, y: 0.5 },
    })
    expect(decoded?.image).toEqual(image)
  })
})

describe("binary messages", () => {
  const data = new Uint8Array([0xff, 0xd8, 0x00, 0x10, 0x7f])

  it("round trips a json header and the raw bytes", () => {
    const header = {
      t: "result",
      id: "call-1",
      ok: true,
      value: { content: [{ type: "image", data: { [IMAGE_REF]: 0 }, mimeType: "image/jpeg" }] },
      parts: [{ mime: "image/jpeg", length: data.byteLength }],
    }

    const decoded = decodeBinary(encodeBinary(header, data))

    expect(decoded?.header).toEqual(header)
    expect(decoded?.data).toEqual(data)
  })

  it("keeps the payload byte for byte after a header longer than a short string", () => {
    const header = { t: "result", id: "call-2", ok: true, note: "x".repeat(300) }

    const decoded = decodeBinary(encodeBinary(header, data))

    expect(Array.from(decoded?.data ?? [])).toEqual(Array.from(data))
  })

  it("does not mistake a live frame for a binary message", () => {
    const live = encodeFrame({ kind: "jpeg", width: 4, height: 4, seq: 1, cursor: null }, data)

    expect(decodeBinary(live)).toBeNull()
    expect(decodeFrame(encodeBinary({ t: "result" }, data))).toBeNull()
  })

  it("rejects a truncated message", () => {
    const bytes = encodeBinary({ t: "result" }, data)

    expect(decodeBinary(bytes.subarray(0, 3))).toBeNull()
  })
})
