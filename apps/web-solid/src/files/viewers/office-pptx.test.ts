import { describe, expect, it } from "vitest"
import { parsePptx } from "./office-pptx"

const slide = (title: string, body: string, imageId?: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>${body}</a:t></a:r></a:p>
      <a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>First stop</a:t></a:r></a:p>
      <a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Second stop</a:t></a:r></a:p>
    </p:txBody></p:sp>
    ${imageId ? `<p:pic><p:blipFill><a:blip r:embed="${imageId}"/></p:blipFill></p:pic>` : ""}
  </p:spTree></p:cSld>
</p:sld>`

describe("parsePptx", () => {
  it("reads a title, body paragraphs, bullets and pictures per slide", () => {
    const relationships = new Map([["rId3", "ppt/media/photo.png"]])
    const [first, second] = parsePptx([
      { xml: slide("Trip", "Three cities", "rId3"), relationships },
      { xml: slide("Budget", "Under 900"), relationships: new Map() },
    ])
    expect(first!.title).toBe("Trip")
    expect(first!.blocks).toEqual([
      { kind: "heading", level: 1, text: "Trip" },
      { kind: "paragraph", text: "Three cities" },
      { kind: "list", ordered: false, items: ["First stop", "Second stop"] },
      { kind: "image", path: "ppt/media/photo.png" },
    ])
    expect(second!.blocks[0]).toEqual({ kind: "heading", level: 1, text: "Budget" })
  })

  it("falls back to a slide number when the deck has no title", () => {
    const [only] = parsePptx([{ xml: slide("", "Body"), relationships: new Map() }])
    expect(only!.title).toBe("Slide 1")
    expect(only!.blocks).toContainEqual({ kind: "paragraph", text: "Body" })
  })
})
