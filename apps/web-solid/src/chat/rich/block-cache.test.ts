import { parseRichText } from "@kiko/protocol/markdown"
import { describe, expect, it } from "vitest"
import { createRichTextCache } from "./block-cache"

const source = [
  "# A heading",
  "",
  "A first paragraph with **bold** and [a link](https://example.com).",
  "",
  "- one",
  "- two",
  "",
  "> a quote",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```ts",
  "const value = 1",
  "",
  "const other = 2",
  "```",
  "",
  "A closing sentence.",
].join("\n")

describe("createRichTextCache", () => {
  it("matches a full parse for every prefix of a growing document", () => {
    const cache = createRichTextCache()
    for (let length = 0; length <= source.length; length++) {
      const text = source.slice(0, length)
      expect(cache.parse(text)).toEqual(parseRichText(text))
    }
  })

  it("matches a full parse when a rewrite replaces the document", () => {
    const cache = createRichTextCache()
    expect(cache.parse("first\n\nparagraph")).toEqual(parseRichText("first\n\nparagraph"))
    expect(cache.parse("replacement")).toEqual(parseRichText("replacement"))
  })

  it("matches a full parse as a long document grows a line at a time", () => {
    const cache = createRichTextCache()
    const lines = Array.from({ length: 60 }, (_, index) =>
      index % 3 === 0
        ? `## Section ${index}`
        : `Line ${index} with **bold** and [a link](https://example.com/${index}).`,
    )
    let text = ""
    for (const line of lines) {
      text += `${line}\n`
      expect(cache.parse(text)).toEqual(parseRichText(text))
      text += "\n"
      expect(cache.parse(text)).toEqual(parseRichText(text))
    }
  })

  it("matches a full parse when definitions arrive late", () => {
    const cache = createRichTextCache()
    expect(cache.parse("A [label].\n\nNext.")).toEqual(parseRichText("A [label].\n\nNext."))
    const withDefinition = "A [label].\n\nNext.\n\n[label]: https://example.com"
    expect(cache.parse(withDefinition)).toEqual(parseRichText(withDefinition))
  })
})
