// The memory screen's state. Every change applies here first and goes to the server
// after, the way the chat does. When the server says no, the change is undone and the
// reason is kept in `error`. The list holds every record, archived ones too, so search
// and the archived group need no round trip.

import type { MemoryRecord, MemoryVersion } from "@kiko/protocol"
import { createStore, produce, reconcile } from "solid-js/store"
import type { MemoryClient } from "./client"

export const AUTHOR = "human"

export type MemoryState = {
	loaded: boolean
	error: string | null
	records: MemoryRecord[]
	/** Old bodies by record id, newest first. Absent until the history panel asks. */
	history: Record<string, MemoryVersion[]>
}

export type MemoryStore = ReturnType<typeof createMemoryStore>

export function createMemoryStore(client: MemoryClient, now: () => number = Date.now) {
	const [state, setState] = createStore<MemoryState>({ loaded: false, error: null, records: [], history: {} })

	const find = (id: string) => state.records.find((r) => r.id === id)
	const patch = (id: string, change: Partial<MemoryRecord>) =>
		setState("records", (r) => r.id === id, produce((r) => Object.assign(r, change)))
	const merge = (record: MemoryRecord) => {
		if (find(record.id)) patch(record.id, record)
		else setState("records", (list) => [...list, record])
	}
	const fail = (message: string) => setState("error", message)

	async function load() {
		const result = await client.request({ op: "list", includeArchived: true })
		if (result.ok && "records" in result) {
			setState({ loaded: true, error: null })
			setState("records", reconcile([...result.records], { key: "id" }))
		}
		else {
			setState("loaded", true)
			fail(result.ok ? "kiko sent something unexpected" : result.error)
		}
	}

	/** Runs one change: applies `apply` now, sends `op`, and calls `undo` when it fails. */
	async function change(op: Parameters<MemoryClient["request"]>[0], apply: () => void, undo: () => void) {
		setState("error", null)
		apply()
		const result = await client.request(op)
		if (!result.ok) {
			undo()
			fail(result.error)
			return
		}
		if ("record" in result && result.record) merge(result.record)
	}

	function pin(id: string, pinned: boolean) {
		const before = find(id)
		if (!before) return
		const was = before.pinned
		return change({ op: "pin", id, pinned }, () => patch(id, { pinned }), () => patch(id, { pinned: was }))
	}

	function archive(id: string, archived: boolean) {
		const before = find(id)
		if (!before) return
		const was = before.archived
		return change({ op: "archive", id, archived }, () => patch(id, { archived }), () => patch(id, { archived: was }))
	}

	async function remove(id: string) {
		const before = find(id)
		if (!before) return
		const index = state.records.indexOf(before)
		const record = { ...before }
		setState("error", null)
		setState("records", (list) => list.filter((r) => r.id !== id))
		const result = await client.request({ op: "remove", id })
		if (!result.ok) {
			setState("records", (list) => [...list.slice(0, index), record, ...list.slice(index)])
			fail(result.error)
		}
	}

	/** Reads the old bodies. Runs again after every save, so the panel matches the server. */
	async function loadHistory(id: string) {
		const result = await client.request({ op: "history", id })
		if (result.ok && "versions" in result) setState("history", id, [...result.versions])
	}

	/** Sets the body. The old body shows in history at once. */
	async function save(id: string, body: string) {
		const before = find(id)
		if (!before || before.body === body) return
		const old = { body: before.body, version: before.version, updatedAt: before.updatedAt }
		const entry: MemoryVersion = { recordId: id, version: old.version, body: old.body, author: AUTHOR, at: now() }
		await change(
			{ op: "replace", id, body, author: AUTHOR },
			() => {
				patch(id, { body, version: old.version + 1, updatedAt: entry.at })
				if (state.history[id]) setState("history", id, (h) => [entry, ...h])
			},
			() => {
				patch(id, old)
				if (state.history[id]) setState("history", id, (h) => h.filter((v) => v.version !== old.version))
			},
		)
		if (state.history[id]) await loadHistory(id)
	}

	return {
		state,
		load,
		get: find,
		dismissError: () => setState("error", null),
		pin,
		archive,
		remove,
		save,
		loadHistory,
		/** Restores an old body. It is a new version, so nothing in history is lost. */
		restore: (id: string, version: MemoryVersion) => save(id, version.body),
	}
}
