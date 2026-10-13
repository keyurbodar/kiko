// The memory screen's state: the user's life log (architecture section 13). Every change applies
// here first and goes to the server after, the way the chat does. When the server says no, the
// change is undone and the reason is kept in `error`. The log is append-only: the human pins,
// redacts, and adds lines, and never rewrites one.

import type { LifeLine, MemoryModel, MemoryOp, MemoryResult } from "@kiko/protocol"
import { createStore, produce } from "solid-js/store"
import type { MemoryClient } from "./client"

export type MemoryState = {
	loaded: boolean
	error: string | null
	/** Newest first. */
	lines: LifeLine[]
	/** The `before` of the next page, or null when the oldest line is loaded. */
	next: number | null
	/** What every agent reads: pinned lines, then the log with older lines compressed. */
	view: string[]
	/** Summary lines opened by `zoom`, by id. */
	opened: Record<string, string[]>
	results: LifeLine[] | null
	model: MemoryModel
}

export type MemoryStore = ReturnType<typeof createMemoryStore>

const PAGE = 50

export function createMemoryStore(client: MemoryClient, now: () => number = Date.now) {
	const [state, setState] = createStore<MemoryState>({ loaded: false, error: null, lines: [], next: null, view: [], opened: {}, results: null, model: null })

	const ask = async (op: MemoryOp): Promise<MemoryResult | null> => {
		const result = await client.request(op)
		if (result.ok) return result
		setState("error", result.error)
		return null
	}
	const patch = (pos: number, change: Partial<LifeLine>) => setState("lines", (l) => l.pos === pos, produce((l) => Object.assign(l, change)))

	async function load() {
		const [list, view, model] = await Promise.all([ask({ op: "list", limit: PAGE }), ask({ op: "view" }), ask({ op: "model" })])
		setState("loaded", true)
		if (list && "lines" in list) setState({ lines: [...list.lines], next: list.lines.length < PAGE ? null : list.next })
		if (view && "text" in view) setState("view", [...view.text])
		if (model && "model" in model) setState("model", model.model)
	}

	async function more() {
		if (state.next === null) return
		const list = await ask({ op: "list", before: state.next, limit: PAGE })
		if (list && "lines" in list) setState({ lines: [...state.lines, ...list.lines], next: list.lines.length < PAGE ? null : list.next })
	}

	async function refreshView() {
		const view = await ask({ op: "view" })
		if (view && "text" in view) setState("view", [...view.text])
	}

	/** Runs one change: applies `apply` now, sends `op`, and calls `undo` when it fails. */
	async function change(op: MemoryOp, apply: () => void, undo: () => void): Promise<boolean> {
		setState("error", null)
		apply()
		const result = await client.request(op)
		if (result.ok) return true
		undo()
		setState("error", result.error)
		return false
	}

	return {
		state,
		load,
		more,
		pin(pos: number, pinned: boolean) {
			void change({ op: "pin", pos, pinned }, () => patch(pos, { pinned }), () => patch(pos, { pinned: !pinned })).then((ok) => {
				if (ok) void refreshView()
			})
		},
		redact(pos: number) {
			const before = state.lines.find((l) => l.pos === pos)
			if (!before) return
			const was = { ...before }
			void change({ op: "redact", pos }, () => patch(pos, { text: "", redacted: true, pinned: false }), () => patch(pos, was)).then((ok) => {
				if (ok) void refreshView()
			})
		},
		async note(text: string) {
			const line = text.replace(/\s+/g, " ").trim()
			if (!line) return
			const temp: LifeLine = { pos: -now(), at: now(), text: line, source: "you", pinned: false, redacted: false }
			const ok = await change({ op: "note", text: line }, () => setState("lines", (l) => [temp, ...l]), () => setState("lines", (l) => l.filter((x) => x.pos !== temp.pos)))
			if (ok) await load()
		},
		async search(query: string) {
			if (!query.trim()) return setState("results", null)
			const out = await ask({ op: "search", query })
			if (out && "lines" in out) setState("results", [...out.lines])
		},
		async zoom(id: string) {
			if (state.opened[id]) return setState("opened", id, undefined as never)
			const out = await ask({ op: "zoom", id })
			if (out && "text" in out) setState("opened", id, [...out.text])
		},
		async setModel(model: MemoryModel) {
			const before = state.model
			await change({ op: "set_model", model }, () => setState("model", model), () => setState("model", before))
		},
		dismissError() {
			setState("error", null)
		},
	}
}
