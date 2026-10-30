import { describe, expect, it } from "vitest"
import { chipLabel, hrefFile, isFileLabel } from "./file-links"

describe("attachment links", () => {
  it("reads a stored attachment path as the original file name", () => {
    const file = hrefFile("/attachments/m5x2k9-notes.md")
    expect(file?.path).toBe("attachments/m5x2k9-notes.md")
    expect(chipLabel(file!)).toBe("notes.md")
  })

  it("keeps a dashed file name whole after the stored prefix", () => {
    const file = hrefFile("/attachments/m5x2k9-my-trip-photo.png")
    expect(chipLabel(file!)).toBe("my-trip-photo.png")
  })

  it("treats a link label that names the attachment as the chip for it", () => {
    const file = hrefFile("/attachments/m5x2k9-notes.md")
    expect(isFileLabel("notes.md", file!)).toBe(true)
    expect(isFileLabel("other.md", file!)).toBe(false)
  })
})
