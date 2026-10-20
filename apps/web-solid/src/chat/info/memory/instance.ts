import { watchChanged } from "../../../sync/changed"
import { createMemoryClient, type MemoryClient } from "./client"
import { createMemoryStore, type MemoryStore } from "./store"

let current: { userId: string; store: MemoryStore; client: MemoryClient } | null = null


export async function memoryFor(userId: string): Promise<MemoryStore> {
	if (current?.userId === userId) return current.store
	current?.client.close()
	const client = createMemoryClient()
	const store = createMemoryStore(client)
	current = { userId, store, client }
	watchChanged("memory", () => (current?.store.state.loaded ? current.store.load() : undefined))
	return store
}
