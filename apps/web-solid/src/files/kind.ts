import type { FileRef } from "@kiko/protocol"
import { isTextFile } from "./api"

export type ViewerKind =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "diff"
  | "text"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "mermaid"
  | "notebook"
  | "font"
  | "archive"
  | "docx"
  | "xlsx"
  | "pptx"
  | "other"

export const TEXT_KINDS: ReadonlySet<ViewerKind> = new Set(["markdown", "json", "csv", "html", "diff", "text"])
export const RENDERED: Partial<Record<ViewerKind, "markdown" | "table" | "html">> = {
  markdown: "markdown",
  csv: "table",
  html: "html",
}

type FileLike = Pick<FileRef, "name" | "type">

const ext = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""

const IMAGE_EXT = /^(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic|heif|svg)$/
const ARCHIVE_EXT = /^(zip|jar)$/

const RULES: readonly [ViewerKind, (f: FileLike, e: string) => boolean][] = [
  ["markdown", (f, e) => e === "md" || e === "mdx" || e === "markdown" || f.type === "text/markdown"],
  ["notebook", (f, e) => e === "ipynb" || f.type === "application/x-ipynb+json"],
  ["json", (f, e) => e === "json" || e === "jsonc" || f.type === "application/json"],
  ["csv", (f, e) => e === "csv" || e === "tsv" || f.type === "text/csv" || f.type === "text/tab-separated-values"],
  ["html", (f, e) => e === "html" || e === "htm" || f.type === "text/html"],
  ["mermaid", (f, e) => e === "mmd" || e === "mermaid" || f.type === "text/vnd.mermaid"],
  ["font", (f, e) => f.type.startsWith("font/") || /^(ttf|otf|woff2?)$/.test(e)],
  [
    "docx",
    (f, e) => e === "docx" || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["xlsx", (f, e) => e === "xlsx" || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [
    "pptx",
    (f, e) => e === "pptx" || f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ["pdf", (f, e) => e === "pdf" || f.type === "application/pdf"],
  [
    "archive",
    (f, e) =>
      ARCHIVE_EXT.test(e) ||
      f.type === "application/zip" ||
      f.type === "application/x-zip-compressed" ||
      f.type === "application/java-archive",
  ],
  ["image", (f, e) => f.type.startsWith("image/") || IMAGE_EXT.test(e)],
  ["video", (f, e) => f.type.startsWith("video/") || /^(mp4|webm|mov|m4v|ogv)$/.test(e)],
  ["audio", (f, e) => f.type.startsWith("audio/") || /^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(e)],
  ["diff", (f, e) => e === "diff" || e === "patch" || f.type === "text/x-diff" || f.type === "text/x-patch"],
  ["text", (f) => isTextFile(f)],
]

export function viewerKind(file: FileLike): ViewerKind {
  const e = ext(file.name)
  return RULES.find(([, test]) => test(file, e))?.[0] ?? "other"
}
