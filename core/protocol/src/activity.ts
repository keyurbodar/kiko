import type { RichText } from "./rich-text"
import { plainText } from "./rich-text"
import type { FileRef } from "./room"

export type LastKind =
  | "text"
  | "photo"
  | "video"
  | "album"
  | "file"
  | "voice"
  | "audio"
  | "link"
  | "react"
  | "joined"
  | "left"
  | "renamed"
  | "created"
  | "notice"

export type ChatLast = {
  from: "human" | "agent" | "system"
  name?: string
  kind: LastKind
  text?: string
  file?: string
  count?: number
  emoji?: string
  at: number
}

const MAX_TEXT = 120
const URL_ONLY = /^https?:\/\/\S+$/i

export function oneLine(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function fileName(path: string): string {
  const m = /^attachments\/[0-9a-z]+-(.+)$/.exec(path)
  const name = m?.[1]
  return name ?? path.split("/").pop() ?? path
}

type Files = readonly Pick<FileRef, "name" | "type">[]

export function messageLast(m: {
  from: ChatLast["from"]
  name?: string
  text: string
  rich?: RichText
  mentionName?: (slug: string) => string
  files?: Files
  at: number
}): ChatLast {
  const base: ChatLast = {
    from: m.from,
    ...(m.from === "agent" && m.name ? { name: m.name } : {}),
    kind: "text",
    at: m.at,
  }
  const text = oneLine(m.rich?.length ? plainText(m.rich, m.mentionName) : m.text)
  const caption = text ? { text } : {}
  const files = m.files ?? []
  if (m.from === "system") return { ...base, kind: "notice", ...caption }
  const [head] = files
  if (head) {
    const n = files.length
    const images = files.filter((f) => f.type.startsWith("image/")).length
    const videos = files.filter((f) => f.type.startsWith("video/")).length
    if (images + videos === n) {
      const kind = images === n ? "photo" : videos === n ? "video" : "album"
      return { ...base, kind, ...(n > 1 && kind !== "album" ? { count: n } : {}), ...caption }
    }
    const first = fileName(head.name)
    if (n === 1 && head.type.startsWith("audio/")) {
      return /^voice/i.test(first)
        ? { ...base, kind: "voice", ...caption }
        : { ...base, kind: "audio", file: first, ...caption }
    }
    return { ...base, kind: "file", ...(n > 1 ? { count: n } : { file: first }), ...caption }
  }
  return { ...base, kind: URL_ONLY.test(text) ? "link" : "text", text }
}

export function humanHandle(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? ""
  const handle = first
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32)
  return handle || "you"
}

export function mentionsHuman(text: string, handle: string | null, repliesToHuman: boolean): boolean {
  if (repliesToHuman) return true
  if (!handle) return false
  const at = new RegExp(`(^|[^a-z0-9_@-])@${handle}(?![a-z0-9-])`, "i")
  return at.test(text)
}
