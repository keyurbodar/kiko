import { sha256Hex } from "@yuki/durable/hash"
import type { RoomFs } from "../../files/room-fs"

// Big tool output. pi-durable keeps a result to 50 KB and cuts at the last line break that fits, so
// a large single-line JSON document (an OpenAPI spec, a connected app's listing) came back as its first
// line and nothing else, and the agent fetched it again and again. A result over `SPILL_BYTES` is
// saved whole in the chat's files, as lines a model can search, and the agent gets its start and
// the path.

export const SPILL_BYTES = 40 * 1024
const HEAD_BYTES = 8 * 1024

const encoder = new TextEncoder()

function parsed(value: string): unknown {
  const t = value.trim()
  if (!(t.startsWith("{") || t.startsWith("["))) return value
  try {
    return JSON.parse(t)
  } catch {
    return value
  }
}

const opened = (value: unknown): unknown =>
  typeof value === "string" ? (parsed(value) === value ? value : opened(parsed(value))) : Array.isArray(value) ? value.map(opened) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, opened(v)])) : value

export function readable(text: string): string {
  const value = parsed(text)
  return value === text ? text : JSON.stringify(opened(value), null, 2)
}

function head(text: string, bytes: number): string {
  let out = ""
  let used = 0
  for (const line of text.split("\n")) {
    const size = encoder.encode(line).length + 1
    if (used + size > bytes) break
    out += `${line}\n`
    used += size
  }
  return out || text.slice(0, Math.floor(bytes / 4))
}

async function sha8(text: string): Promise<string> {
  return (await sha256Hex(text)).slice(0, 8)
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "result"

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
