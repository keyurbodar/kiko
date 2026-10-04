import { type MessageId, type Sender, type SearchHit, SNIPPET_CLOSE, SNIPPET_OPEN } from "@kiko/protocol"

// Message search for one room. Architecture section 9.2. The FTS5 index
// `messages_fts` is kept by triggers (schema.ts), so this file only reads it.
//
// Speed. The index is read in rowid order, newest first, so a page stops after `limit` rows and
// `snippet()` runs for those rows only. Ordering by `messages.seq` instead made SQLite sort every
// match, and build a snippet for each, before the limit applied: a one-letter prefix in a room of
// 10,000 messages paid for 10,000 snippets. A message's rowid grows with its seq, because rows are
// only ever inserted in seq order and a deleted message keeps its row.

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type SearchPage = { results: SearchHit[]; next: number | null }

export type SearchOptions = {
	/** A seq: only older messages are returned. The `next` of the previous page. */
	before?: number
	/** A time in epoch ms: only older messages are returned. For the search across chats. */
	beforeAt?: number
	limit?: number
}

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

/** Live messages that match, newest first. */
export function searchMessages(sql: SqlStorage, query: string, options: SearchOptions = {}): SearchPage {
	const match = toMatch(query)
	if (!match) return { results: [], next: null }
	const size = Math.min(Math.max(options.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
	// The seq cursor becomes a rowid bound, which the index applies itself.
	const below =
		options.before === undefined
			? Number.MAX_SAFE_INTEGER
			: (sql.exec<{ r: number | null }>("SELECT min(rowid) AS r FROM messages WHERE seq >= ?", options.before).one().r ??
				Number.MAX_SAFE_INTEGER)
	const rows = sql
		.exec<{ id: string; seq: number; at: number; sender: string; snippet: string }>(
			`SELECT m.id, m.seq, m.at, m.sender, snippet(messages_fts, 0, ?, ?, '…', 16) AS snippet
			 FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
			 WHERE messages_fts MATCH ? AND messages_fts.rowid < ? AND m.at < ?
			 ORDER BY messages_fts.rowid DESC LIMIT ?`,
			SNIPPET_OPEN,
			SNIPPET_CLOSE,
			match,
			below,
			options.beforeAt ?? Number.MAX_SAFE_INTEGER,
			size + 1,
		)
		.toArray()
	const page = rows.slice(0, size)
	return {
		results: page.map((r) => ({ id: r.id as MessageId, seq: r.seq, at: r.at, from: JSON.parse(r.sender) as Sender, snippet: r.snippet })),
		next: rows.length > size ? (page[page.length - 1]?.seq ?? null) : null,
	}
}
