import type { MessageId, SearchHit } from "@kiko/protocol"

// Message search for one room. Architecture section 9.2. The FTS5 index
// `messages_fts` is kept by triggers (schema.ts), so this file only reads it.

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type SearchPage = { results: SearchHit[]; next: number | null }

/**
 * Turns what the human typed into an FTS5 query. Every word is quoted so FTS syntax
 * in the text cannot break the query, and the last word matches as a prefix so
 * search works while typing. Returns null when no word is left.
 */
export function toMatch(query: string): string | null {
	const words = query
		.split(/\s+/)
		.map((w) => w.replaceAll('"', ""))
		.filter(Boolean)
		.slice(0, 12)
	if (!words.length) return null
	return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ")
}

/** Live messages that match, newest first. `before` is a seq: only older messages are returned. */
export function searchMessages(sql: SqlStorage, query: string, before?: number, limit?: number): SearchPage {
	const match = toMatch(query)
	if (!match) return { results: [], next: null }
	const size = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
	const rows = sql
		.exec<{ id: string; seq: number; snippet: string }>(
			`SELECT m.id, m.seq, snippet(messages_fts, 0, '', '', '…', 16) AS snippet
			 FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
			 WHERE messages_fts MATCH ? AND m.seq < ?
			 ORDER BY m.seq DESC LIMIT ?`,
			match,
			before ?? Number.MAX_SAFE_INTEGER,
			size + 1,
		)
		.toArray()
	const page = rows.slice(0, size)
	return {
		results: page.map((r) => ({ id: r.id as MessageId, seq: r.seq, snippet: r.snippet })),
		next: rows.length > size ? (page[page.length - 1]?.seq ?? null) : null,
	}
}
