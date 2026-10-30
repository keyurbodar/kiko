import { linkTarget } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { onlyFileLinks } from "./attachments"

const file = (name: string, type: string) => ({ name, type, path: `attachments/abc-${name}` })
const link = (f: { name: string; path: string }) => `[${f.name}](${linkTarget(`/${f.path}`)})`

describe("onlyFileLinks", () => {
  const notes = file("notes.md", "text/markdown")
  const sky = file("sky.png", "image/png")

  it("is true when the text is nothing but links to the message's own files", () => {
    expect(onlyFileLinks([notes, sky], `${link(notes)} ${link(sky)} `)).toBe(true)
  })

  it("is false when the owner wrote anything else", () => {
    expect(onlyFileLinks([notes, sky], `look at ${link(sky)}`)).toBe(false)
    expect(onlyFileLinks([notes], `[think] ${link(notes)}`)).toBe(false)
  })

  it("is false for text with no files or links elsewhere", () => {
    expect(onlyFileLinks([], "")).toBe(false)
    expect(onlyFileLinks([notes], "[other](/attachments/zzz-other.md)")).toBe(false)
  })
})
