import { describe, expect, it } from "vitest"
import { firstLines, planFor, previewKey, tableHead, textPreview } from "./model"

const file = (name: string, size = 1000) => ({ name, size })

describe("planFor", () => {
  it("reads only the head of text files", () => {
    expect(planFor("markdown", file("a.md"))).toEqual({ kind: "text", type: "markdown", bytes: 6000 })
    expect(planFor("code", file("a.ts"))).toMatchObject({ kind: "text", type: "code" })
    expect(planFor("csv", file("a.csv"))).toMatchObject({ kind: "text", type: "csv" })
  })

  it("renders xlsx and pdf whole, but not when they are huge", () => {
    expect(planFor("sheet", file("a.xlsx"))).toEqual({ kind: "sheet", bytes: 1000 })
    expect(planFor("sheet", file("a.xls"))).toEqual({ kind: "none" })
    expect(planFor("sheet", file("a.xlsx", 40 * 1024 * 1024))).toEqual({ kind: "none" })
    expect(planFor("pdf", file("a.pdf"))).toEqual({ kind: "pdf", bytes: 1000 })
    expect(planFor("pdf", file("a.pdf", 90 * 1024 * 1024))).toEqual({ kind: "none" })
  })

  it("falls back for types it cannot draw", () => {
    expect(planFor("archive", file("a.zip"))).toEqual({ kind: "none" })
    expect(planFor("video", file("a.mp4"))).toEqual({ kind: "none" })
    expect(planFor("image", file("a.png"))).toEqual({ kind: "image" })
  })
})

describe("previewKey", () => {
  it("changes when the file id or size changes", () => {
    const a = previewKey({ id: "x", size: 1 })
    expect(previewKey({ id: "y", size: 1 })).not.toBe(a)
    expect(previewKey({ id: "x", size: 2 })).not.toBe(a)
  })
})

describe("firstLines", () => {
  it("skips leading blank lines, expands tabs and caps the count and width", () => {
    const lines = firstLines(`\n\n\tconst a = 1\r\n${"x".repeat(200)}\n${"line\n".repeat(40)}`)
    expect(lines[0]).toBe("  const a = 1")
    expect(lines[1]!.length).toBe(96)
    expect(lines.length).toBe(16)
  })
})

describe("tableHead", () => {
  it("drops empty rows and clips rows, columns and cells", () => {
    const rows = [["", ""], ["a", "b", "c", "d", "e", "f", "g"], ...Array.from({ length: 20 }, () => ["1"])]
    const head = tableHead(rows)
    expect(head[0]).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(head.length).toBe(9)
    expect(tableHead([["y".repeat(50)]])[0]![0]!.length).toBe(32)
  })
})

describe("textPreview", () => {
  it("turns each text type into its preview", () => {
    expect(textPreview("markdown", "a.md", "# Hi")).toEqual({ kind: "markdown", text: "# Hi" })
    expect(textPreview("html", "a.html", "<p>x</p>")).toEqual({ kind: "html", html: "<p>x</p>" })
    expect(textPreview("csv", "a.csv", "a,b\n1,2\n")).toEqual({
      kind: "table",
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
    })
    expect(textPreview("csv", "a.tsv", "a\tb\n")).toEqual({ kind: "table", rows: [["a", "b"]] })
    expect(textPreview("code", "a.ts", "let a")).toEqual({ kind: "lines", lines: ["let a"], mono: true })
    expect(textPreview("text", "a.txt", "hello")).toEqual({ kind: "lines", lines: ["hello"], mono: false })
  })

  it("drops markdown front matter", () => {
    expect(textPreview("markdown", "a.md", "---\ntitle: x\n---\n# Body")).toEqual({ kind: "markdown", text: "# Body" })
    expect(textPreview("markdown", "a.md", "---\nname: only\n---\n")).toEqual({ kind: "none" })
  })

  it("falls back for empty files", () => {
    expect(textPreview("markdown", "a.md", "  \n")).toEqual({ kind: "none" })
    expect(textPreview("csv", "a.csv", "")).toEqual({ kind: "none" })
    expect(textPreview("text", "a.txt", "\n\n")).toEqual({ kind: "none" })
  })
})
