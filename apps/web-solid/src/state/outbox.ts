import type { Message, RoomId } from "@kiko/protocol"
import { createComputed, createSignal, untrack } from "solid-js"
import { forgetUpload, releaseUpload, retryUpload, uploadsStatus } from "../composer/uploads"
import type { MessageFile } from "../lib/types"

export type Outbound = {
  readonly commandId: string
  readonly roomId: RoomId
  readonly message: Message
  readonly files: readonly MessageFile[]
  readonly uploads: readonly string[]
  readonly deliver: () => Promise<unknown>
}

export function createOutbox() {
  const [entries, setEntries] = createSignal<readonly Outbound[]>([])
  const delivering = new Set<string>()
  const drop = (entry: Outbound) => setEntries((list) => list.filter((e) => e !== entry))
  const find = (messageId: string) => entries().find((entry) => entry.message.id === messageId)

  createComputed(() => {
    for (const entry of entries()) {
      if (delivering.has(entry.commandId) || uploadsStatus(entry.uploads) !== "ready") continue
      delivering.add(entry.commandId)
      untrack(
        () =>
          void entry.deliver().finally(() => {
            delivering.delete(entry.commandId)
            drop(entry)
            for (const id of entry.uploads) forgetUpload(id)
          }),
      )
    }
  })

  return {
    add: (entry: Outbound) => setEntries((list) => [...list, entry]),
    queued: (roomId: RoomId) =>
      entries()
        .filter((entry) => entry.roomId === roomId)
        .map((entry) => ({ entry, failed: uploadsStatus(entry.uploads) === "failed" })),
    retry(messageId: string): boolean {
      const entry = find(messageId)
      if (!entry) return false
      for (const id of entry.uploads) retryUpload(id)
      return true
    },
    remove(messageId: string): boolean {
      const entry = find(messageId)
      if (!entry || delivering.has(entry.commandId)) return !!entry
      drop(entry)
      for (const file of entry.files) URL.revokeObjectURL(file.src)
      for (const id of entry.uploads) releaseUpload(id)
      return true
    },
  }
}
