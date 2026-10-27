import { describe, expect, it } from "vitest"
import { isVideo } from "../../lib/attachments"
import { messageGallery } from "./chat-images"

const file = (name: string, type: string, path?: string) => ({
  name,
  type,
  size: 10,
  src: `blob:${name}`,
  ...(path ? { path } : {}),
})

describe("messageGallery", () => {
  it("holds only the images and videos of the one message it is given", () => {
    const gallery = messageGallery([
      file("a.png", "image/png", "attachments/a.png"),
      file("notes.pdf", "application/pdf"),
      file("clip.mp4", "video/mp4"),
      file("b.jpg", "image/jpeg"),
    ])

    expect(gallery.map((item) => item.name)).toEqual(["a.png", "b.jpg", "clip.mp4"])
    expect(gallery[0]?.path).toBe("attachments/a.png")
    expect(gallery.map((item) => item.video === true)).toEqual([false, false, true])
  })

  it("is empty for a message with only documents", () => {
    expect(messageGallery([file("notes.pdf", "application/pdf")])).toEqual([])
  })
})

describe("isVideo", () => {
  it("reads the type, then falls back to the extension", () => {
    expect(isVideo({ name: "x", type: "video/webm" })).toBe(true)
    expect(isVideo({ name: "x.MOV", type: "application/octet-stream" })).toBe(true)
    expect(isVideo({ name: "x.png", type: "image/png" })).toBe(false)
  })
})
