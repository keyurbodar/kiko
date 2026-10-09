import { describe, expect, test } from "bun:test"
import { richTextSegments, type RichSegment } from "./segments"
import { FULL_REG_EXP, URL_REG_EXP } from "./regex"

// A pattern that does not compile throws at IMPORT time, which no assertion
// below this line can reach — the module fails to load and every test reports
// the same SyntaxError instead of the case it was written for. These two exist
// because that failure mode is invisible until someone runs the app.
describe("patterns", () => {
  test("every pattern compiles", () => {
    expect(() => new RegExp(URL_REG_EXP)).not.toThrow()
    expect(() => new RegExp(FULL_REG_EXP)).not.toThrow()
  })
})

/** Every run the renderer would draw, as `[kind, text]` pairs. */
function shape(text: string): [RichSegment["kind"], string][] {
  return richTextSegments(text).map((segment) => [segment.kind, segment.text])
}

/** Only the runs that carry an href, as `[text, href]` pairs. */
function links(text: string): [string, string][] {
  return richTextSegments(text)
    .filter((segment) => segment.href !== undefined)
    .map((segment) => [segment.text, segment.href as string])
}

/**
 * The body as the reader sees it: every run's text, concatenated. Compared
 * against the input everywhere, because a renderer that drops or duplicates a
 * character is a renderer that has lost something the sender wrote — and no
 * assertion about which runs matched would notice.
 */
function rendered(text: string): string {
  return richTextSegments(text)
    .map((segment) => segment.text)
    .join("")
}

describe("richTextSegments", () => {
  test("a bare https url becomes one run, text preserved exactly", () => {
    expect(shape("https://example.com/a/b?c=d")).toEqual([["url", "https://example.com/a/b?c=d"]])
    expect(links("https://example.com/a/b?c=d")).toEqual([
      ["https://example.com/a/b?c=d", "https://example.com/a/b?c=d"],
    ])
    expect(rendered("https://example.com/a/b?c=d")).toBe("https://example.com/a/b?c=d")
  })

  test("a file name inside a path is not a link, even when its extension is a TLD", () => {
    expect(links("see /plan/route.md")).toEqual([])
    expect(links("src\\route.md")).toEqual([])
    expect(rendered("see /plan/route.md")).toBe("see /plan/route.md")
    // The same name on its own is still a domain.
    expect(links("route.md")).toEqual([["route.md", "https://route.md"]])
  })

  test("sentence punctuation after a url stays out of the href", () => {
    // A full stop and a comma end the path rather than joining it.
    expect(links("see https://example.com.")).toEqual([
      ["https://example.com", "https://example.com"],
    ])
    expect(links("see https://example.com,")).toEqual([
      ["https://example.com", "https://example.com"],
    ])
    // An unbalanced closing bracket is the sentence's, not the link's.
    expect(links("(see https://example.com/x)")).toEqual([
      ["https://example.com/x", "https://example.com/x"],
    ])
    expect(rendered("(see https://example.com/x)")).toBe("(see https://example.com/x)")
  })

  test("an unbalanced closing bracket is prose, not part of the link", () => {
    const body = "read (https://example.com/a_(b) now"
    expect(links(body)).toEqual([["https://example.com/a_(b)", "https://example.com/a_(b)"]])
    expect(rendered(body)).toBe(body)
  })

  test("a scheme-less run links only when its TLD is real", () => {
    expect(links("www.example.com")).toEqual([["www.example.com", "https://www.example.com"]])
    expect(links("example.com")).toEqual([["example.com", "https://example.com"]])
    // `.bar` is a real gTLD, so the gate's negative has to use a suffix that is
    // not a registry at all — otherwise this test passes for the wrong reason.
    expect(shape("foo.notatld")).toEqual([["text", "foo.notatld"]])
    expect(rendered("foo.notatld")).toBe("foo.notatld")
  })

  test("a bare scheme degrades to text instead of throwing", () => {
    expect(() => richTextSegments("https://")).not.toThrow()
    expect(shape("https://")).toEqual([["text", "https://"]])
    expect(rendered("https://")).toBe("https://")
  })

  test("an email becomes one mailto run", () => {
    expect(shape("write to me@example.com today")).toEqual([
      ["text", "write to "],
      ["email", "me@example.com"],
      ["text", " today"],
    ])
    expect(links("me@example.com")).toEqual([["me@example.com", "mailto:me@example.com"]])
  })

  test("a mention and a hashtag carry no href", () => {
    const segments = richTextSegments("@name and #tag shipped it")
    expect(shape("@name and #tag shipped it")).toEqual([
      ["mention", "@name"],
      ["text", " and "],
      ["hashtag", "#tag"],
      ["text", " shipped it"],
    ])
    expect(segments.filter((segment) => segment.kind !== "text").every((s) => s.href === undefined)).toBe(true)
  })

  test("a cashtag shape is not a hashtag", () => {
    expect(shape("$ABC is not a tag")).toEqual([["text", "$ABC is not a tag"]])
  })

  test("a javascript payload never yields a javascript href", () => {
    const body = "javascript:alert(1)"
    expect(() => richTextSegments(body)).not.toThrow()
    for (const [text, href] of links(body)) {
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false)
      expect(rendered(body)).toContain(text)
    }
    expect(rendered(body)).toBe(body)
  })

  test("a homograph host is marked suspicious so the renderer can refuse the href", () => {
    const [segment] = richTextSegments("https://аррӏе.com")
    expect(segment.kind).toBe("url")
    expect(segment.suspicious).toBe(true)

    const [honest] = richTextSegments("https://example.com")
    expect(honest.suspicious).toBe(false)
  })

  test("a mixed body keeps every run, in order, with no gap and no repeat", () => {
    const body = "ask @name about https://example.com/a or mail me@example.com re #tag"
    expect(shape(body)).toEqual([
      ["text", "ask "],
      ["mention", "@name"],
      ["text", " about "],
      ["url", "https://example.com/a"],
      ["text", " or mail "],
      ["email", "me@example.com"],
      ["text", " re "],
      ["hashtag", "#tag"],
    ])
    expect(rendered(body)).toBe(body)
  })

  test("every body is losslessly reproduced", () => {
    for (const body of [
      "",
      "   ",
      "plain prose with no entities at all",
      "https://example.com https://other.example.com",
      "a\nb\rc\td",
      "https://例え.jp",
      "(#tag) [@name] www.example.com.",
      "trailing entity https://example.com",
    ]) {
      expect(rendered(body)).toBe(body)
    }
  })
})
