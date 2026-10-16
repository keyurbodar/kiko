import { type MessageId, plainText, type RichText, type Sender, type SearchHit, SNIPPET_CLOSE, SNIPPET_OPEN } from "@kiko/protocol"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type SearchPage = { results: SearchHit[]; next: number | null }

export type SearchOptions = {
	before?: number
	beforeAt?: number
	limit?: number
	/** Include mail between agents. The transcript folds it behind a line, so a person's search leaves it out. */
	mail?: boolean
}

const AFTER = 100
const BEFORE = 40

const queryWords = (query: string) =>
	query
		.split(/\s+/)
		.map((w) => w.replaceAll('"', ""))
		.filter(Boolean)
		.slice(0, 12)

/**
 * A window of the message's plain words around the first match, with the matches between the
 * snippet marks. The index holds the markdown, so the window is cut from the plain text instead.
 */
export function snippetOf(plain: string, query: string): string {
	const flat = plain.replace(/\s+/g, " ").trim()
	const words = queryWords(query)
	const edge = "[\\p{L}\\p{N}]"
	const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const pattern = new RegExp(`(?<!${edge})(?:${words.map((w, i) => `${escape(w)}${i === words.length - 1 ? `${edge}*` : `(?!${edge})`}`).join("|")})`, "giu")
	const first = pattern.exec(flat)
	pattern.lastIndex = 0
	const from = first ? Math.max(0, first.index - BEFORE) : 0
	let start = from
	if (from > 0) {
		const space = flat.indexOf(" ", from)
		start = space >= 0 && space < (first?.index ?? 0) ? space + 1 : from
	}
	const end = Math.min(flat.length, start + BEFORE + AFTER)
	const window = flat.slice(start, end).replace(pattern, (m) => `${SNIPPET_OPEN}${m}${SNIPPET_CLOSE}`)
	return `${start > 0 ? "…" : ""}${window}${end < flat.length ? "…" : ""}`
}

export function toMatch(query: string): string | null {
	const words = queryWords(query)
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
		.exec<{ id: string; seq: number; at: number; sender: string; text: string; rich: string | null }>(
			`SELECT m.id, m.seq, m.at, m.sender, m.text, m.rich
			 FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
			 WHERE messages_fts MATCH ? AND messages_fts.rowid < ? AND m.at < ? AND (m.event IS NULL OR json_extract(m.event, '$.private') IS NOT 1)${options.mail ? "" : " AND m.addressed IS NULL"}
			 ORDER BY messages_fts.rowid DESC LIMIT ?`,
			match,
			below,
			options.beforeAt ?? Number.MAX_SAFE_INTEGER,
			size + 1,
		)
		.toArray()
	const page = rows.slice(0, size)
	return {
		results: page.map((r) => ({ id: r.id as MessageId, seq: r.seq, at: r.at, from: JSON.parse(r.sender) as Sender, snippet: snippetOf(r.rich ? plainText(JSON.parse(r.rich) as RichText) : r.text, query) })),
		next: rows.length > size ? (page[page.length - 1]?.seq ?? null) : null,
	}
}
