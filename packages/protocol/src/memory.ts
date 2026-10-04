// Architecture section 13. The memory screen reads the user's life log over the user socket. Each
// request carries a `reqId` and gets one `memory_result` back, to the socket that asked. The log is
// append-only: the human can pin a line, redact one, or add one, never rewrite one.

/** One line of the user's life log. `source` is who wrote it: `@ada`, `chat trip`, or `you`. */
export type LifeLine = {
	pos: number
	/** Epoch milliseconds. */
	at: number
	text: string
	source: string
	/** Written by a run that read outside content. */
	tainted: boolean
	pinned: boolean
	redacted: boolean
}

/** The model that writes memory summaries. Null means the default. */
export type MemoryModel = { provider: string; modelId: string } | null

export type MemoryOp =
	/** The newest lines, or the lines before `before`. */
	| { op: "list"; before?: number; limit?: number }
	/** What every agent reads: pinned lines, then the log with older lines compressed. */
	| { op: "view" }
	| { op: "search"; query: string }
	/** A summary line opened into its halves, such as `64-127`. */
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
