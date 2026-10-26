import { sha256Hex } from "@kiko/durable/hash"
import type { RoomFs } from "../../files/room-fs"

const SPILL_BYTES = 40 * 1024
const HEAD_BYTES = 5 * 1024
const TAIL_BYTES = 3 * 1024

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
  typeof value === "string"
    ? parsed(value) === value
      ? value
      : opened(parsed(value))
    : Array.isArray(value)
      ? value.map(opened)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, opened(v)]))
        : value

function readable(text: string): string {
  const value = parsed(text)
  return value === text ? text : JSON.stringify(opened(value), null, 2)
}

function lines(list: string[], bytes: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of list) {
    const size = encoder.encode(line).length + 1
    if (used + size > bytes) break
    out.push(line)
    used += size
  }
  return out
}

function ends(text: string): { start: string; end: string; cut: number } {
  const all = text.split("\n")
  const start = lines(all, HEAD_BYTES)
  const end = lines(all.slice(start.length).toReversed(), TAIL_BYTES).toReversed()
  if (start.length && end.length)
    return { start: start.join("\n"), end: end.join("\n"), cut: all.length - start.length - end.length }
  return { start: text.slice(0, HEAD_BYTES / 4), end: text.slice(-TAIL_BYTES / 4), cut: 0 }
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
  const { start, end, cut } = ends(body)
  const gap = cut ? `${cut} lines cut from the middle of ${size}` : `the middle of ${size} is cut`
  const both = (marker: string) => `${start}\n\n(${marker})\n\n${end}`
  if (!fs) return both(`${gap}.`)
  const ext = body !== text ? "json" : "txt"
  const path = `/downloads/${slug(label)}-${await sha8(body)}.${ext}`
  const saved = (await fs.stat(path)).ok || (await fs.write(path, encoder.encode(body))).ok
  if (!saved) return both(`${gap}, and the whole result could not be saved.`)
  return both(
    `${gap}. the whole result is saved at ${path}. view it with read and an offset, or search it with bash, like grep -n "word" ${path}. do not fetch it again.`,
  )
}
