// request carries a `reqId` and gets one `memory_result` back, to the socket that asked. The log is
// append-only: the human can pin a line, redact one, or add one, never rewrite one.

export type LifeLine = {
	pos: number
	at: number
	text: string
	source: string
	pinned: boolean
	redacted: boolean
	supersededBy?: number | null
}

export type MemoryModel = { provider: string; modelId: string } | null

export type MemoryOp =
	| { op: "list"; before?: number; limit?: number }
	| { op: "view" }
	| { op: "search"; query: string }
	| { op: "zoom"; id: string }
	| { op: "note"; text: string }
	| { op: "pin"; pos: number; pinned: boolean }
	| { op: "redact"; pos: number }
	| { op: "model" }
	| { op: "set_model"; model: MemoryModel }

export type MemoryResult =
	| { ok: true; lines: readonly LifeLine[]; next: number | null }
	| { ok: true; text: readonly string[] }
	| { ok: true; model: MemoryModel }
	| { ok: true }
	| { ok: false; error: string }
