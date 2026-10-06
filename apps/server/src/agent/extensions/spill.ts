import type { RoomFs } from "../../files/room-fs"

// Big tool output. pi-durable keeps a result to 50 KB and cuts at the last line break that fits, so
// a large single-line JSON document (an OpenAPI spec, an Executor search) came back as its first
// line and nothing else, and the agent fetched it again and again. A result over `SPILL_BYTES` is
// saved whole in the chat's files, as lines a model can search, and the agent gets its start and
// the path. `read` and `bash` results are outside content, so reading the file later still taints.

/** Results up to this size come back whole. pi-durable's own limit is 50 KB. */
export const SPILL_BYTES = 40 * 1024
/** How much of a saved result the agent sees at once. */
const HEAD_BYTES = 8 * 1024

const encoder = new TextEncoder()

/** `value` parsed when it is a string holding a JSON object or array, else unchanged. */
function parsed(value: string): unknown {
  const t = value.trim()
  if (!(t.startsWith("{") || t.startsWith("["))) return value
  try {
    return JSON.parse(t)
  } catch {
    return value
  }
}

/** Strings that hold JSON, opened in place: Executor returns a program's value as a JSON string. */
const opened = (value: unknown): unknown =>
  typeof value === "string" ? (parsed(value) === value ? value : opened(parsed(value))) : Array.isArray(value) ? value.map(opened) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, opened(v)])) : value

/** JSON pretty-printed, with JSON inside its strings opened too, so grep and read find lines in it. */
export function readable(text: string): string {
  const value = parsed(text)
  return value === text ? text : JSON.stringify(opened(value), null, 2)
}

/** The first whole lines of `text` within `bytes`, or its first `bytes` when one line is longer. */
function head(text: string, bytes: number): string {
  let out = ""
  for (const line of text.split("\n")) {
    if (encoder.encode(out + line).length + 1 > bytes) break
    out += `${line}\n`
  }
  return out || text.slice(0, Math.floor(bytes / 4))
}

async function sha8(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))
  return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** A file name from `label`: lowercase letters, digits, dots and dashes. */
const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "result"

/**
 * `text` as a tool returns it. Small text comes back unchanged. Big text is saved at
 * `/downloads/<label>-<hash>.<ext>` and comes back as its start and a pointer. The same content
 * always lands at the same path, so a repeated call writes nothing new. Without files, the start
 * and how much was left out.
 */
export async function spill(fs: RoomFs | undefined, label: string, text: string): Promise<string> {
  if (encoder.encode(text).length <= SPILL_BYTES) return text
  const body = readable(text)
  const size = `${Math.round(encoder.encode(body).length / 1024)} kb, ${body.split("\n").length} lines`
  const start = head(body, HEAD_BYTES)
  if (!fs) return `${start}\n(cut: the whole result is ${size})`
  const ext = body !== text ? "json" : "txt"
  const path = `/downloads/${slug(label)}-${await sha8(body)}.${ext}`
  const saved = (await fs.stat(path)).ok || (await fs.write(path, encoder.encode(body))).ok
  if (!saved) return `${start}\n(cut: the whole result is ${size}, and it could not be saved)`
  return `${start}\n(the start of ${size}. the whole result is saved at ${path}. search it with bash, like grep -n "word" ${path}, or read it with read and an offset. do not fetch it again.)`
}
