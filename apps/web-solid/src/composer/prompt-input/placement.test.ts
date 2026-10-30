import { describe, expect, it } from "vitest"
import { attachmentToken } from "@kiko/protocol"
import { trayAttachments } from "./placement"
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

describe("trayAttachments", () => {
  it("shows only the files whose chip is still in the text, in tray order", () => {
    const prompt: PromptInputV2Prompt = [
      text(`Read ${attachmentToken("b", "b.md")} first`),
      file("a"),
      file("b"),
      file("c"),
    ]
    expect(trayAttachments(prompt).map((part) => part.id)).toEqual(["b"])
  })

  it("hides every file when the text has no chips", () => {
    expect(trayAttachments([text("hello"), file("a")])).toEqual([])
  })

  it("brings a file back when its chip is restored", () => {
    const chip = attachmentToken("a", "a.md")
    expect(trayAttachments([text(chip), file("a")]).map((part) => part.id)).toEqual(["a"])
    expect(trayAttachments([text(""), file("a")])).toEqual([])
    expect(trayAttachments([text(chip), file("a")]).map((part) => part.id)).toEqual(["a"])
  })
})
