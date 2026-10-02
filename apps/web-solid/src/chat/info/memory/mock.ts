// The dev mock. A dev build with `VITE_KIKO_SYNC=mock` answers memory requests from
// this in-memory store, the way the dev mock answers chats. It follows the server's rules
// for the three singletons, versions, and archived records, and no more.

import type { MemoryOp, MemoryRecord, MemoryResult, MemoryVersion } from "@kiko/protocol"
import type { MemoryClient } from "./client"

const SINGLETONS: readonly string[] = ["profile", "now", "todo"]

export function createMockMemory(now: () => number = Date.now): MemoryClient {
	const records = new Map<string, MemoryRecord>()
	const versions = new Map<string, MemoryVersion[]>()
	const t0 = now()
	const add = (r: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "type" | "title">, age = 0) =>
		records.set(r.id, {
			aliases: [],
			body: "",
			pinned: false,
			archived: false,
			uses: 0,
			lastUsedAt: 0,
			createdAt: t0 - age,
			updatedAt: t0 - age,
			version: 1,
			...r,
		})
	add({ id: "profile", type: "profile", title: "profile", body: "- 2026-09-01: lives in lisbon (human)\n- 2026-09-02: works on [[kiko]] (human)" }, 3000)
	add({ id: "now", type: "now", title: "now" }, 3000)
	add({ id: "todo", type: "todo", title: "todo" }, 3000)
	add({ id: "kiko", type: "organization", title: "kiko", aliases: ["the app"], body: "- 2026-09-02: a chat app that feels like telegram (human)" }, 2000)
	add({ id: "margaret", type: "person", title: "margaret", aliases: ["mum"], body: "- 2026-09-03: likes tea (human)" }, 1000)

	function handle(op: MemoryOp): MemoryResult {
		switch (op.op) {
			case "list":
				return { ok: true, records: [...records.values()].filter((r) => op.includeArchived || !r.archived) }
			case "search":
				return { ok: true, records: [] }
			case "view":
				return { ok: true, record: records.get(op.id) ?? null }
			case "history":
				return { ok: true, versions: versions.get(op.id) ?? [] }
			case "replace": {
				const r = records.get(op.id)
				if (!r) return { ok: false, error: `no memory record ${op.id}` }
				const log = versions.get(op.id) ?? []
				log.unshift({ recordId: op.id, version: r.version, body: r.body, author: op.author, at: now() })
				versions.set(op.id, log)
				const next = { ...r, body: op.body, version: r.version + 1, updatedAt: now() }
				records.set(op.id, next)
				return { ok: true, record: next }
			}
			case "pin":
			case "archive": {
				const r = records.get(op.id)
				if (!r) return { ok: false, error: `no memory record ${op.id}` }
				if (op.op === "archive" && op.archived && SINGLETONS.includes(op.id))
					return { ok: false, error: `${op.id} cannot be archived` }
				const next = { ...r, updatedAt: now(), ...(op.op === "pin" ? { pinned: op.pinned } : { archived: op.archived }) }
				records.set(op.id, next)
				return { ok: true, record: next }
			}
			case "remove":
				if (SINGLETONS.includes(op.id)) return { ok: false, error: `${op.id} cannot be removed` }
				versions.delete(op.id)
				return { ok: true, removed: records.delete(op.id) }
			default:
				return { ok: false, error: "the mock does not do that" }
		}
	}

	return { request: async (op) => structuredClone(handle(op)), close() {} }
}
