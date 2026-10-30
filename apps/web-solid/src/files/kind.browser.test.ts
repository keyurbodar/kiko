import { describe, expect, it } from "vitest"
import { RENDERED, TEXT_KINDS, viewerKind, type ViewerKind } from "./kind"

const kind = (name: string, type = ""): ViewerKind => viewerKind({ name, type })

describe("viewerKind", () => {
  it("spots markdown and notebooks before JSON", () => {
    expect(kind("notes.md")).toBe("markdown")
    expect(kind("notes.mdx")).toBe("markdown")
    expect(kind("readme.markdown")).toBe("markdown")
    expect(kind("notes.markdown", "text/markdown")).toBe("markdown")
    expect(kind("analysis.ipynb")).toBe("notebook")
    expect(kind("analysis.ipynb", "application/json")).toBe("notebook")
    expect(kind("data.json")).toBe("json")
    expect(kind("data.jsonc")).toBe("json")
  })

  it("spots tables, pages and diagrams", () => {
    expect(kind("data.csv")).toBe("csv")
    expect(kind("data.tsv")).toBe("csv")
    expect(kind("data.txt", "text/csv")).toBe("csv")
    expect(kind("page.html")).toBe("html")
    expect(kind("page.htm")).toBe("html")
    expect(kind("flow.mmd")).toBe("mermaid")
    expect(kind("flow.mermaid")).toBe("mermaid")
  })

  it("spots fonts by extension and by type", () => {
    expect(kind("Inter.ttf")).toBe("font")
    expect(kind("Inter.otf")).toBe("font")
    expect(kind("Inter.woff")).toBe("font")
    expect(kind("Inter.woff2")).toBe("font")
    expect(kind("Inter", "font/woff2")).toBe("font")
  })

  it("spots the three Open XML Office formats", () => {
    expect(kind("memo.docx")).toBe("docx")
    expect(kind("budget.xlsx")).toBe("xlsx")
    expect(kind("talk.pptx")).toBe("pptx")
    expect(kind("memo.docx", "application/octet-stream")).toBe("docx")
  })

  it("spots pdf, archives and images", () => {
    expect(kind("guide.pdf")).toBe("pdf")
    expect(kind("guide.pdf", "application/pdf")).toBe("pdf")
    expect(kind("bundle.zip")).toBe("archive")
    expect(kind("bundle.jar")).toBe("archive")
    expect(kind("bundle", "application/zip")).toBe("archive")
    expect(kind("photo.png")).toBe("image")
    expect(kind("photo.jpeg")).toBe("image")
    expect(kind("photo.webp")).toBe("image")
    expect(kind("photo.avif")).toBe("image")
    expect(kind("photo.heic")).toBe("image")
    expect(kind("drawing.svg")).toBe("image")
    expect(kind("drawing.svg", "image/svg+xml")).toBe("image")
  })

  it("spots media", () => {
    expect(kind("clip.mp4")).toBe("video")
    expect(kind("clip.webm")).toBe("video")
    expect(kind("voice.mp3")).toBe("audio")
    expect(kind("voice.flac")).toBe("audio")
    expect(kind("voice.m4a", "audio/mp4")).toBe("audio")
  })

  it("keeps patches as diffs and everything else as text", () => {
    expect(kind("change.diff")).toBe("diff")
    expect(kind("change.patch")).toBe("diff")
    expect(kind("main.ts")).toBe("text")
    expect(kind("Makefile")).toBe("other")
  })

  it("leaves formats it cannot render to the hex view", () => {
    expect(kind("archive.tar")).toBe("other")
    expect(kind("archive.gz")).toBe("other")
    expect(kind("database.sqlite")).toBe("other")
    expect(kind("slides.odp")).toBe("other")
    expect(kind("notes.odt")).toBe("other")
    expect(kind("unknown.bin")).toBe("other")
  })

  it("keeps the rendered map to the three surface toggles", () => {
    expect(RENDERED).toEqual({ markdown: "markdown", csv: "table", html: "html" })
    expect(TEXT_KINDS.has("mermaid")).toBe(false)
    expect(TEXT_KINDS.has("docx")).toBe(false)
  })
})
