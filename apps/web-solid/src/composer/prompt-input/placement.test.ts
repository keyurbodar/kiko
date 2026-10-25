import { describe, expect, it } from "vitest"
import { attachmentToken } from "@kiko/protocol"
import { attachPlacement, droppedChips, trayAttachments } from "./placement"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

const file = (id: string, filename = `${id}.md`): PromptInputV2Attachment => ({
  type: "image",
  id,
  filename,
  mime: "text/markdown",
  size: 10,
  blob: { id: `blob-${id}`, url: `blob:${id}` },
})

const text = (content: string): PromptInputV2Prompt[number] => ({
  type: "text",
  content,
  start: 0,
  end: content.length,
})

describe("attachPlacement", () => {
  it("puts a pasted or dropped file inline when the draft has words", () => {
    expect(attachPlacement("paste", "Read this")).toBe("inline")
    expect(attachPlacement("drop", "Compare ")).toBe("inline")
  })

  it("sends files to the tray when the draft is empty or only whitespace", () => {
    expect(attachPlacement("paste", "")).toBe("tray")
    expect(attachPlacement("drop", "  \n ")).toBe("tray")
  })

  it("always sends files picked with the + button to the tray", () => {
    expect(attachPlacement("picker", "Read this")).toBe("tray")
  })
})

describe("trayAttachments", () => {
  it("leaves out files that sit inline as chips, in tray order", () => {
    const prompt: PromptInputV2Prompt = [
      text(`Read ${attachmentToken("b", "b.md")} first`),
      file("a"),
      file("b"),
      file("c"),
    ]
    expect(trayAttachments(prompt).map((part) => part.id)).toEqual(["a", "c"])
  })

  it("shows every file when the text has no chips", () => {
    expect(trayAttachments([text("hello"), file("a")]).map((part) => part.id)).toEqual(["a"])
  })
})

describe("droppedChips", () => {
  it("names the files whose inline chip the owner deleted", () => {
    const before = `A ${attachmentToken("a", "a.md")} and ${attachmentToken("b", "b.md")}`
    const after = `A ${attachmentToken("a", "a.md")} and `
    expect(droppedChips(before, after)).toEqual(["b"])
  })

  it("names nothing when a chip only moved or the text grew", () => {
    const chip = attachmentToken("a", "a.md")
    expect(droppedChips(`x ${chip}`, `${chip} x y`)).toEqual([])
  })
})
