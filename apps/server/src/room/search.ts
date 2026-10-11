import { type MessageId, type Sender, type SearchHit, SNIPPET_CLOSE, SNIPPET_OPEN } from "@yuki/protocol"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type SearchPage = { results: SearchHit[]; next: number | null }

export type SearchOptions = {
	before?: number
	beforeAt?: number
	limit?: number
}

export function toMatch(query: string): string | null {
	const words = query
		.split(/\s+/)
		.map((w) => w.replaceAll('"', ""))
		.filter(Boolean)
		.slice(0, 12)
	if (!words.length) return null
	return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ")
}

export function searchMessages(sql: SqlStorage, query: string, options: SearchOptions = {}): SearchPage {
	const match = toMatch(query)
	if (!match) return { results: [], next: null }
	const size = Math.min(Math.max(options.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
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
