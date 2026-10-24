import type { FileRef } from "@kiko/protocol"
import { viewerKind } from "./kind"
import type { TYPE_GLYPHS } from "./type-glyphs"

export type FileType = Exclude<keyof typeof TYPE_GLYPHS, "folder">
export type FileGroup = "documents" | "data" | "images" | "code" | "media"

const ext = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""

const CODE_EXT =
  /^(tsx?|jsx?|mjs|cjs|py|rs|go|rb|java|kt|c|h|cpp|hpp|sh|zsh|sql|css|scss|json|jsonc|ya?ml|toml|xml|diff|patch)$/

export function fileType(file: Pick<FileRef, "name" | "type">): FileType {
  const e = ext(file.name)
  if (/^(xlsx?|numbers|ods)$/.test(e)) return "sheet"
  if (/^(docx?|pages|odt|rtf)$/.test(e)) return "doc"
  if (/^(pptx?|key|odp)$/.test(e)) return "slides"
  if (/^(zip|tar|gz|tgz|7z|rar|bz2)$/.test(e)) return "archive"
  const kind = viewerKind(file)
  if (kind === "markdown" || kind === "pdf" || kind === "csv" || kind === "html" || kind === "image") return kind
  if (kind === "audio" || kind === "video") return kind
  if (kind === "json" || kind === "diff" || CODE_EXT.test(e)) return "code"
  return kind === "text" ? "text" : "other"
}

const GROUPS: Record<FileType, FileGroup | null> = {
  pdf: "documents",
  markdown: "documents",
  text: "documents",
  doc: "documents",
  slides: "documents",
  csv: "data",
  sheet: "data",
  image: "images",
  html: "code",
  code: "code",
  video: "media",
  audio: "media",
  archive: null,
  other: null,
}

export const groupOf = (type: FileType): FileGroup | null => GROUPS[type]

export const GROUP_LABELS: Record<FileGroup, string> = {
  documents: "Documents",
  data: "Data",
  images: "Images",
  code: "Code",
  media: "Media",
}

export const TYPE_TINT: Record<FileType, string> = {
  pdf: "oklch(0.7 0.15 25)",
  markdown: "oklch(0.72 0.1 250)",
  text: "oklch(0.72 0.03 260)",
  doc: "oklch(0.72 0.12 255)",
  slides: "oklch(0.74 0.14 55)",
  csv: "oklch(0.74 0.13 155)",
  sheet: "oklch(0.74 0.13 155)",
  image: "oklch(0.74 0.12 310)",
  html: "oklch(0.75 0.14 50)",
  code: "oklch(0.74 0.1 200)",
  video: "oklch(0.72 0.13 340)",
  audio: "oklch(0.74 0.12 285)",
  archive: "oklch(0.74 0.09 85)",
  other: "oklch(0.72 0.02 260)",
}

export const TYPE_NAMES: Record<FileType, string> = {
  pdf: "PDF",
  markdown: "Markdown",
  text: "Text",
  doc: "Document",
  slides: "Slides",
  csv: "CSV",
  sheet: "Spreadsheet",
  image: "Image",
  html: "HTML",
  code: "Code",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  other: "File",
}
