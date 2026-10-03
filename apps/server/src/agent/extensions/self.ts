import { defineExtension, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { CHAT_PATH, MAX_CHAT, type RoomFs, type SoulPort } from "../../files/room-fs"

// Architecture section 8.4. Fills the `soul` and `chat` slots of the system prompt from two files
// the agent keeps itself: /me/soul.md (who it is, in every chat) and /chat.md (what this chat is
// for). Both render before each request, so an edit lands on the next turn, and both are capped,
// so neither grows into a token sink.

export const SELF = "self"

export function selfExtension(fs: RoomFs, soul: SoulPort): Extension {
  return defineExtension({
    name: SELF,
    wraps: [
      wrapSection("soul", (slot) => ({ ...slot, render: async () => (await soul.get()).body.trim() || undefined })),
      wrapSection("chat", (slot) => ({
        ...slot,
        render: async () => {
          const found = await fs.stat(CHAT_PATH)
          if (!found.ok || found.value.kind !== "file") return undefined
          const bytes = await fs.bytesOf(found.value, MAX_CHAT)
          const text = bytes ? new TextDecoder().decode(bytes).trim() : ""
          return text ? `/chat.md:\n${text}` : undefined
        },
      })),
    ],
  })
}
