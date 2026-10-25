import type { FileRef } from "@kiko/protocol"
import { parseDelimited } from "../delimited"
import type { FileType } from "../type"

export type Rows = readonly (readonly string[])[]

export type Preview =
  | { kind: "markdown"; text: string }
  | { kind: "lines"; lines: readonly string[]; mono: boolean }
  | { kind: "table"; rows: Rows }
  | { kind: "html"; html: string }
  | { kind: "picture"; blob: Blob }
  | { kind: "none" }

export type Plan =
  | { kind: "text"; type: "markdown" | "code" | "text" | "csv" | "html"; bytes: number }
  | { kind: "sheet" | "pdf"; bytes: number }
  | { kind: "image" }
  | { kind: "none" }

const MB = 1024 * 1024
const LINES = 16
const LINE_CHARS = 96
const TABLE_ROWS = 9
const TABLE_COLUMNS = 6
const CELL_CHARS = 32

const TEXT_BYTES: Record<"markdown" | "code" | "text" | "csv" | "html", number> = {
  markdown: 6000,
  code: 3000,
  text: 3000,
  csv: 12_000,
  html: 256 * 1024,
}

export function planFor(type: FileType, file: Pick<FileRef, "name" | "size">): Plan {
  if (type === "markdown" || type === "code" || type === "text" || type === "csv" || type === "html")
    return { kind: "text", type, bytes: TEXT_BYTES[type] }
  if (type === "image") return { kind: "image" }
  if (type === "sheet" && /\.xlsx$/i.test(file.name) && file.size <= 8 * MB) return { kind: "sheet", bytes: file.size }
  if (type === "pdf" && file.size <= 25 * MB) return { kind: "pdf", bytes: file.size }
  return { kind: "none" }
}

export const previewKey = (file: Pick<FileRef, "id" | "size">) => `v2:${file.id}:${file.size}`

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function firstLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n")
  while (lines.length && lines[0]!.trim() === "") lines.shift()
  return lines.slice(0, LINES).map((line) => clip(line.trimEnd(), LINE_CHARS))
}

export function tableHead(rows: Rows): string[][] {
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .slice(0, TABLE_ROWS)
    .map((row) => row.slice(0, TABLE_COLUMNS).map((cell) => clip(cell.trim(), CELL_CHARS)))
}

const withoutFrontMatter = (text: string) => text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")

export function textPreview(type: "markdown" | "code" | "text" | "csv" | "html", name: string, text: string): Preview {
  if (type === "markdown") {
    const body = withoutFrontMatter(text)
    return body.trim() ? { kind: "markdown", text: body } : { kind: "none" }
  }
  if (type === "html") return text.trim() ? { kind: "html", html: text } : { kind: "none" }
  if (type === "csv") {
    const rows = tableHead(parseDelimited(text, /\.tsv$/i.test(name) ? "\t" : ",", TABLE_ROWS + 4).rows)
    return rows.length ? { kind: "table", rows } : { kind: "none" }
  }
  const lines = firstLines(text)
  return lines.length ? { kind: "lines", lines, mono: type === "code" } : { kind: "none" }
}
