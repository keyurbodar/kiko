import { parseDelimitedRows } from "../delimited"
import {
  MAX_BYTES,
  MAX_CELL_CHARS,
  MAX_COLUMNS,
  MAX_ROWS,
  PAGE_ROWS,
  splitLines,
  type TextRequest,
  type TextResult,
} from "./large-text-model"

const post = (value: TextResult) =>
  (self as unknown as { postMessage: (value: unknown, transfer: Transferable[]) => void }).postMessage(value, [])

let text = ""
let bounds: number[] = [0]
let count = 0
let columns = 1
let delimiter: "," | "\t" | null = null

type QuoteState = { quoted: boolean; fieldStart: boolean }

function stepDelimited(
  source: string,
  index: number,
  separator: string,
  state: QuoteState,
): { index: number; column: boolean; handled: boolean } {
  const code = source.charCodeAt(index)
  if (state.quoted) {
    if (code !== 34) return { index, column: false, handled: true }
    if (source.charCodeAt(index + 1) === 34) return { index: index + 1, column: false, handled: true }
    state.quoted = false
    return { index, column: false, handled: true }
  }
  if (code === 34 && state.fieldStart) {
    state.quoted = true
    state.fieldStart = false
    return { index, column: false, handled: true }
  }
  if (code === separator.charCodeAt(0)) {
    state.fieldStart = true
    return { index, column: true, handled: true }
  }
  state.fieldStart = false
  return { index, column: false, handled: false }
}

function indexRows(
  source: string,
  separator: "," | "\t" | null,
): { bounds: number[]; columns: number; complete: boolean } {
  const starts = [0]
  const quotes: QuoteState = { quoted: false, fieldStart: true }
  let widest = 1
  let rowColumns = 1
  for (let index = 0; index < source.length; index++) {
    if (separator) {
      const step = stepDelimited(source, index, separator, quotes)
      index = step.index
      if (step.column) rowColumns++
      if (step.handled) continue
    }
    const code = source.charCodeAt(index)
    if (code !== 10 && code !== 13) {
      quotes.fieldStart = false
      continue
    }
    if (code === 13 && source.charCodeAt(index + 1) === 10) index++
    starts.push(index + 1)
    widest = Math.min(MAX_COLUMNS, Math.max(widest, rowColumns))
    rowColumns = 1
    quotes.fieldStart = true
    if (starts.length > MAX_ROWS + 1) return { bounds: starts, columns: widest, complete: false }
  }
  if (starts[starts.length - 1]! < source.length) starts.push(source.length)
  if (separator) widest = Math.min(MAX_COLUMNS, Math.max(widest, rowColumns))
  return { bounds: starts, columns: widest, complete: true }
}

function page(index: number) {
  const start = index * PAGE_ROWS
  if (start >= count) return
  const end = Math.min(count, start + PAGE_ROWS)
  const segment = text.slice(bounds[start], bounds[end])
  const rows = delimiter
    ? parseDelimitedRows(segment, delimiter, {
        maxRows: PAGE_ROWS,
        maxColumns: MAX_COLUMNS,
        maxCellLength: MAX_CELL_CHARS,
      }).rows
    : splitLines(segment.replace(/\r?\n$|\r$/, "")).map((line) => [line])
  post({ type: "page", index, rows })
}

async function fetchBytes(src: string, size: number): Promise<{ bytes: Uint8Array; total: number }> {
  const response = await fetch(src, {
    headers: { range: `bytes=0-${MAX_BYTES - 1}` },
    cache: "no-store",
  })
  if (!response.ok) throw new Error("This file could not be loaded.")
  const bytes = new Uint8Array(await response.arrayBuffer())
  const total = Number(response.headers.get("content-range")?.split("/")[1] ?? size) || bytes.length
  if (total > MAX_BYTES && bytes.length >= MAX_BYTES) return { bytes, total }
  if (bytes.length > MAX_BYTES) throw new Error("Text previews support files up to 32 MB.")
  return { bytes, total: Math.max(total, bytes.length) }
}

async function open(input: Extract<TextRequest, { type: "open" }>) {
  delimiter = input.delimiter
  const { bytes, total } = await fetchBytes(input.src, input.size)
  if (bytes.subarray(0, 8192).includes(0)) throw new Error("This file contains binary data.")
  const truncated = total > bytes.length
  let source: string
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated })
  } catch {
    throw new Error("This file is not UTF-8 text.")
  }
  text = source
  const indexed = indexRows(source, delimiter)
  bounds = indexed.bounds
  count = Math.max(0, bounds.length - 1)
  columns = indexed.columns
  post({ type: "meta", count, columns, complete: indexed.complete && !truncated, size: total })
  if (count > 0) page(0)
}

self.addEventListener("message", (event: MessageEvent<TextRequest>) => {
  const input = event.data
  const work = input.type === "open" ? open(input) : Promise.resolve().then(() => page(input.index))
  void work.catch((cause: unknown) =>
    post({ type: "error", message: cause instanceof Error ? cause.message : "Could not read this file." }),
  )
})
