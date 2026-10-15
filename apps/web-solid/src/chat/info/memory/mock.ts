// DEV ONLY. A memory server in the browser, for `VITE_KIKO_SYNC=mock`. It answers every op the
// way UserDO does, without compression: the view is the pinned lines, then the newest 40.

import type { LifeLine, MemoryModel, MemoryOp, MemoryResult } from "@kiko/protocol"
import type { MemoryClient } from "./client"

export function createMockMemory(now: () => number = Date.now): MemoryClient {
	const lines: LifeLine[] = []
	let model: MemoryModel = null
	const add = (text: string, source: string, daysAgo = 0) =>
		lines.push({ pos: lines.length, at: now() - daysAgo * 86_400_000, text, source, pinned: false, redacted: false })
	add("lives in lisbon, works at a small design studio", "@kiko", 40)
	add("sister is sam; they talk every sunday", "@kiko", 30)
	add("planning a japan trip in november with sam", "chat trip", 6)
	add("prefers short answers before 9am", "@kiko", 1)
	add("moved to porto, still at the studio", "@kiko", 0)
	lines[0]!.supersededBy = 4

	function handle(op: MemoryOp): MemoryResult {
		switch (op.op) {
			case "list": {
				const page = [...lines].reverse().filter((l) => op.before === undefined || l.pos < op.before).slice(0, op.limit ?? 50)
				return { ok: true, lines: page, next: page.at(-1)?.pos ?? null }
			}
			case "view":
				return { ok: true, text: [...lines.filter((l) => l.pinned).map((l) => `pinned: ${l.text}`), ...lines.slice(-40).map((l) => `#${l.pos} ${l.source}: ${l.redacted ? "(removed by the human)" : l.text}`)] }
			case "search":
				return { ok: true, lines: lines.filter((l) => !l.redacted && l.text.includes(op.query.toLowerCase())).reverse(), next: null }
			case "zoom":
				return { ok: false, error: "Not a summary id" }
			case "note":
				add(op.text, "you")
				return { ok: true }
			case "pin": {
				const l = lines[op.pos]
				if (!l || l.redacted) return { ok: false, error: "No such memory" }
				l.pinned = op.pinned
				return { ok: true }
			}
			case "redact": {
				const l = lines[op.pos]
				if (!l || l.redacted) return { ok: false, error: "No such memory" }
				Object.assign(l, { text: "", redacted: true, pinned: false })
				return { ok: true }
			}
			case "model":
				return { ok: true, model }
			case "set_model":
				model = op.model
				return { ok: true }
		}
	}

	return {
		request: async (op) => structuredClone(handle(op)),
		close() {},
	}
}
