import type { TreeChange } from "./file-index"

export type BatchChange = { op: "write"; path: string; bytes: Uint8Array; type: string; expect: string } | TreeChange

export const batchPaths = (c: BatchChange): [string, ...string[]] => (c.op === "move" ? [c.from, c.to] : [c.path])

const MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/x-python",
  svg: "image/svg+xml",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
}

export function typeForPath(path: string): string {
  const dot = path.lastIndexOf(".")
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : ""
  return MIME_BY_EXTENSION[ext] ?? "text/plain"
}
