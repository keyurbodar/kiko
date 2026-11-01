import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export const COLUMNS = [
  "run_id",
  "trial_id",
  "ts",
  "commit",
  "bench_version",
  "task",
  "track",
  "held_out",
  "os",
  "machine",
  "contender",
  "contender_version",
  "model",
  "effort",
  "condition",
  "seed",
  "rep",
  "outcome",
  "pass",
  "checks_passed",
  "checks_total",
  "fail_class",
  "turns",
  "tool_calls",
  "tool_errors",
  "tokens_in",
  "tokens_cached",
  "tokens_out",
  "tokens_reasoning",
  "cost_usd",
  "wall_ms",
  "model_ms",
  "tool_ms",
  "tool_p50_ms",
  "tool_p95_ms",
  "bytes_to_model",
  "images_sent",
  "images_dropped",
  "focus_steals",
  "pointer_moves",
  "keys_swallowed",
  "windows_raised",
  "system_prompt_sha",
  "trajectory",
  "ttft_ms",
  "model_p50_ms",
  "model_p95_ms",
  "tool_transport_ms",
  "tool_op_ms",
  "tool_queue_ms",
  "tool_latency_by_name",
  "images_bytes",
  "bytes_from_tool",
] as const

export type Column = (typeof COLUMNS)[number]
export type Row = { readonly [K in Column]: string | number | boolean }

export const HEADER = COLUMNS.join("\t")

const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
}

const UNESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  t: "\t",
  n: "\n",
  r: "\r",
}

export const escape = (value: string): string => value.replace(/[\\\t\n\r]/g, (char) => ESCAPES[char] ?? char)

export function unescape(value: string): string {
  let out = ""
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char !== "\\") {
      out += char
      continue
    }
    const next = value[index + 1]
    if (next === undefined) {
      out += "\\"
      continue
    }
    out += UNESCAPES[next] ?? `\\${next}`
    index++
  }
  return out
}

export const formatRow = (row: Row): string => COLUMNS.map((column) => escape(String(row[column]))).join("\t")

export function parseRow(line: string): Row {
  const parts = line.split("\t")
  const row: Record<string, string> = {}
  COLUMNS.forEach((column, index) => {
    row[column] = unescape(parts[index] ?? "")
  })
  return row as Row
}

export const toTsv = (rows: readonly Row[]): string => [HEADER, ...rows.map(formatRow)].join("\n") + "\n"

export function parseTsv(text: string): Row[] {
  const lines = text.split("\n").filter((line) => line.length > 0)
  const first = lines[0]
  if (first === undefined) throw new Error("not a bench ledger: the header does not match")
  const header = first.split("\t")
  const current: readonly string[] = COLUMNS
  const known = header.length <= current.length && header.every((column, index) => column === current[index])
  if (!known) throw new Error("not a bench ledger: the header does not match")
  return lines.slice(1).map(parseRow)
}

export async function writeRows(path: string, rows: readonly Row[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, toTsv(rows), "utf8")
}

export async function appendRow(path: string, row: Row): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const exists = await stat(path).catch(() => null)
  const body = exists ? `${formatRow(row)}\n` : `${HEADER}\n${formatRow(row)}\n`
  await appendFile(path, body, "utf8")
}

export async function readRows(path: string): Promise<Row[]> {
  return parseTsv(await readFile(path, "utf8"))
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? 0
}
