import { decodeBinary, encodeBinary, IMAGE_REF, type ImagePart } from "@kiko/computer/frame"
import { describe, expect, it } from "vitest"
import { joinImages } from "./binary"

const IMAGE = new Uint8Array([0xff, 0xd8, 0x00, 0x10, 0x7f])

describe("binary results", () => {
  it("puts the payload bytes back where the daemon took them from", () => {
    const header = {
      t: "result",
      id: "call-1",
      ok: true,
      value: {
        content: [
          { type: "text", text: "window 7" },
          { type: "image", data: { [IMAGE_REF]: 0 }, mimeType: "image/jpeg" },
        ],
      },
      parts: [{ mime: "image/jpeg", length: IMAGE.byteLength }],
    }

    const decoded = decodeBinary(encodeBinary(header, IMAGE))
    const parts = decoded?.header.parts as ImagePart[]
    const value = joinImages(decoded?.header.value, parts, decoded?.data ?? new Uint8Array()) as {
      content: { type: string; data?: unknown }[]
    }

    expect(value.content[0]).toEqual({ type: "text", text: "window 7" })
    expect(value.content[1]?.data).toEqual(IMAGE)
  })

  it("gives each image its own slice of one payload", () => {
    const first = new Uint8Array([1, 2])
    const second = new Uint8Array([3, 4, 5])
    const data = new Uint8Array([...first, ...second])
    const value = {
      images: [{ data: { [IMAGE_REF]: 0 } }, { data: { [IMAGE_REF]: 1 } }],
    }
    const parts: ImagePart[] = [
      { mime: "image/png", length: first.byteLength },
      { mime: "image/png", length: second.byteLength },
    ]

    const joined = joinImages(value, parts, data) as { images: { data: Uint8Array }[] }

    expect(joined.images[0]?.data).toEqual(first)
    expect(joined.images[1]?.data).toEqual(second)
  })
})
