import { defineExtension, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { CHAT_PATH, MAX_CHAT, type RoomFs, type SoulPort } from "../../files/room-fs"

export const SELF = "self"

export function perRun<T>(read: () => Promise<T>, stamp?: () => number): () => Promise<T> {
  if (!stamp) return read
  let kept: { at: number; value: Promise<T> } | undefined
  return () => {
    const at = stamp()
    if (kept?.at === at) return kept.value
    const value = read()
    const entry = { at, value }
    kept = entry
    value.catch(() => {
      if (kept === entry) kept = undefined
    })
    return value
  }
}

export function selfExtension(fs: RoomFs, soul: SoulPort, stamp?: () => number): Extension {
  const soulText = perRun(async () => (await (soul.forPrompt ?? soul.get)()).body.trim() || undefined, stamp)
  const chatText = perRun(async () => {
    const found = await fs.stat(CHAT_PATH)
    if (!found.ok || found.value.kind !== "file") return undefined
    const bytes = await fs.bytesOf(found.value, found.value.size > MAX_CHAT ? MAX_CHAT : undefined)
    const text = bytes ? new TextDecoder().decode(bytes).trim() : ""
    return text ? `/chat.md:\n${text}` : undefined
  }, stamp)
  return defineExtension({
    name: SELF,
    wraps: [
      wrapSection("soul", (slot) => ({ ...slot, render: soulText })),
      wrapSection("chat", (slot) => ({ ...slot, render: chatText })),
    ],
  })
}
