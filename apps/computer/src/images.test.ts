import { IMAGE_REF } from "@kiko/computer/frame"
import { describe, expect, it } from "vitest"
import { splitImages, type Fitter } from "./images"

const BYTES = new Uint8Array([0xff, 0xd8, 0x00, 0x10, 0x7f])
const BASE64 = Buffer.from(BYTES).toString("base64")

const keep: Fitter = async (bytes, mime) => ({ bytes, mime })

describe("splitImages", () => {
  it("takes a cua image out of the result and frames its raw bytes", async () => {
    const value = {
      content: [
        { type: "text", text: "window 7" },
        { type: "image", data: BASE64, mimeType: "image/jpeg" },
      ],
    }

    const split = await splitImages(value, keep)

    expect(split?.value).toEqual({
      content: [
        { type: "text", text: "window 7" },
        { type: "image", data: { [IMAGE_REF]: 0 }, mimeType: "image/jpeg" },
      ],
    })
    expect(split?.parts).toEqual([{ mime: "image/jpeg", length: BYTES.byteLength }])
    expect(split?.data).toEqual(BYTES)
  })

  it("takes a page image out of a browser read", async () => {
    const value = { tab: { id: "t-1" }, outline: "a page", image: { mime: "image/png", data: BASE64 } }

    const split = await splitImages(value, keep)

    expect(split?.value).toEqual({
      tab: { id: "t-1" },
      outline: "a page",
      image: { mime: "image/png", data: { [IMAGE_REF]: 0 } },
    })
    expect(split?.data).toEqual(BYTES)
  })

  it("joins several images into one payload", async () => {
    const value = {
      content: [
        { type: "image", data: BASE64, mimeType: "image/png" },
        { type: "image", data: BASE64, mimeType: "image/png" },
      ],
    }

    const split = await splitImages(value, keep)

    expect(split?.parts.map((part) => part.length)).toEqual([BYTES.byteLength, BYTES.byteLength])
    expect(split?.data).toEqual(new Uint8Array([...BYTES, ...BYTES]))
  })

  it("lets the fitter replace a large image with a smaller one", async () => {
    const small = new Uint8Array([1, 2])
    const shrink: Fitter = async () => ({ bytes: small, mime: "image/jpeg" })

    const split = await splitImages({ image: { mime: "image/png", data: BASE64 } }, shrink)

    expect(split?.value).toEqual({ image: { mime: "image/jpeg", data: { [IMAGE_REF]: 0 } } })
    expect(split?.parts).toEqual([{ mime: "image/jpeg", length: small.byteLength }])
    expect(split?.data).toEqual(small)
  })

  it("leaves a result without images alone", async () => {
    expect(await splitImages({ content: [{ type: "text", text: "no picture" }] }, keep)).toBeNull()
  })
})
