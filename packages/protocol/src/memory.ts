// Architecture section 13. The memory screen reads and edits records over the user
// socket. Each request carries a `reqId` and gets one `memory_result` back, to the
// socket that asked. ASSUMPTION: memory changes are not user events, so a second tab
// refetches instead of replaying.

export type MemoryType = "profile" | "now" | "todo" | "preference" | "person" | "organization" | "conversation" | "procedure"

export type MemoryRecord = {
	id: string
	type: MemoryType
	title: string
	aliases: readonly string[]
	/** Markdown. Dated bullet facts with `[[id]]` links. */
	body: string
	pinned: boolean
	archived: boolean
	uses: number
	/** Epoch milliseconds. 0 when never viewed. */
	lastUsedAt: number
	createdAt: number
	updatedAt: number
	version: number
}

/** An earlier body of a record. `version` is the version that body had. */
export type MemoryVersion = { recordId: string; version: number; body: string; author: string; at: number }

/** Who wrote a fact. `tainted` marks a write from a run that read outside content. */
export type Provenance = { author: string; tainted?: boolean }

export type MemoryOp =
	| { op: "list"; includeArchived?: boolean }
	| { op: "search"; query: string; limit?: number }
	| { op: "view"; id: string }
	| { op: "history"; id: string }
	| { op: "create"; id?: string; type: MemoryType; title: string; aliases?: readonly string[]; body?: string; author: string }
	| { op: "append"; id: string; fact: string; provenance: Provenance }
	| { op: "replace"; id: string; body: string; author: string }
	| { op: "pin"; id: string; pinned: boolean }
	| { op: "archive"; id: string; archived: boolean }
	| { op: "remove"; id: string }

export type MemoryResult =
	| { ok: true; records: readonly MemoryRecord[] }
	| { ok: true; record: MemoryRecord | null }
	| { ok: true; versions: readonly MemoryVersion[] }
	| { ok: true; removed: boolean }
	| { ok: false; error: string }
