// The one memory store for the signed-in user. It outlives the route, so coming back to
// /memory paints the list from what is already here, then refreshes it.

import { onChanged } from "../../../sync/changed"
import { createMemoryClient, type MemoryClient } from "./client"
import { createMemoryStore, type MemoryStore } from "./store"

let current: { userId: string; store: MemoryStore; client: MemoryClient; stop: () => void } | null = null

async function openClient(): Promise<MemoryClient> {
	// The dev mock, same rule as the chat data layer. A production build drops this branch.
	if (import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock") return (await import("./mock")).createMockMemory()
	return createMemoryClient()
}

/** The store for this user. A different user gets a new one, and the old socket closes. */
export async function memoryFor(userId: string): Promise<MemoryStore> {
	if (current?.userId === userId) return current.store
	current?.client.close()
	current?.stop()
	const client = await openClient()
	const store = createMemoryStore(client)
	const stop = onChanged("memory", () => (store.state.loaded ? store.load() : undefined))
	current = { userId, store, client, stop }
	return store
}
