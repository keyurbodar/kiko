import { onChanged } from "../../../sync/changed"
import { createMemoryClient, type MemoryClient } from "./client"
import { createMemoryStore, type MemoryStore } from "./store"

let current: { userId: string; store: MemoryStore; client: MemoryClient; stop: () => void } | null = null

export async function memoryFor(userId: string): Promise<MemoryStore> {
  if (current?.userId === userId) return current.store
  current?.client.close()
  current?.stop()
  const client = createMemoryClient()
  const store = createMemoryStore(client)
  const stop = onChanged("memory", () => (store.state.loaded ? store.load() : undefined))
  current = { userId, store, client, stop }
  return store
}
