import { onUserSignal } from "../../../state/user"
import { memoryClient } from "./client"
import { createMemoryStore, type MemoryStore } from "./store"

let current: { userId: string; store: MemoryStore; stop: () => void } | null = null

export async function memoryFor(userId: string): Promise<MemoryStore> {
  if (current?.userId === userId) return current.store
  current?.stop()
  const store = createMemoryStore(memoryClient)
  const stop = onUserSignal("changed", (signal) => {
    if (signal.what === "memory" && store.state.loaded) void store.load()
  })
  current = { userId, store, stop }
  return store
}
