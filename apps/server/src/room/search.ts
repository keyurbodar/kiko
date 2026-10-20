import { type MessageId, plainText, type RichText, type Sender, type SearchHit, SNIPPET_CLOSE, SNIPPET_OPEN } from "@kiko/protocol"
import { messageSeq } from "./message-position"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export type SearchPage = { results: SearchHit[]; next: number | null }

export type SearchOptions = {
	before?: number
	beforeAt?: number
	limit?: number
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

export function snippetOf(plain: string, query: string): string {
	const flat = plain.replace(/\s+/g, " ").trim()
	const words = queryWords(query)
	const edge = "[\\p{L}\\p{N}]"
	const literal = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const pattern = new RegExp(`(?<!${edge})(?:${words.map((w, i) => `${literal(w)}${i === words.length - 1 ? `${edge}*` : `(?!${edge})`}`).join("|")})`, "giu")
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

const MAX_CHUNK_MESSAGES = 2_000
const MAX_CHUNK_BYTES = 512 * 1024

type Member = [seq: number, start: number, end: number]
type Chunk = { rowid: number; chunk: string; members: string; edit_seq: number }
type IndexedMessage = { seq: number; text: string }
type ResultRow = { id: string; seq: number; at: number; sender: string; text: string; rich: string | null }

function indexChunks(storage: DurableObjectStorage, roomId: string, roomToken: string): void {
	const sql = storage.sql
	const scope = `room:${roomId}`
	storage.transactionSync(() => {
		const state = sql.exec<{ last_seq: number; edit_seq: number }>(
			"SELECT json_extract(value, '$.last_seq') AS last_seq, json_extract(value, '$.edit_seq') AS edit_seq FROM owner_meta WHERE scope = ? AND key = 'search-state'", scope,
		).toArray()[0]
		const lastSeq = sql.exec<{ seq: number }>("SELECT seq FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT 1", roomId).toArray()[0]?.seq ?? 0
		const editSeq = sql.exec<{ seq: number }>("SELECT seq FROM events WHERE room_id = ? ORDER BY seq DESC LIMIT 1", roomId).toArray()[0]?.seq ?? 0
		const hydrated = sql.exec<{ seq: number }>("SELECT CAST(value AS INTEGER) AS seq FROM owner_meta WHERE scope = ? AND key >= 'search-hydrated:' AND key < 'search-hydrated;'", scope).toArray()
		if (state && lastSeq <= state.last_seq && editSeq <= state.edit_seq && !hydrated.length) return
		const dirty = new Set(hydrated.map((row) => row.seq))
		if (state) {
			for (const event of sql.exec<{ kind: string; payload: string }>(
				"SELECT kind, payload FROM events WHERE room_id = ? AND seq > ? AND kind IN ('edit', 'delete')", roomId, state.edit_seq,
			)) {
				const payload = JSON.parse(event.payload) as { messageId?: string; messageIds?: string[] }
				for (const id of payload.messageIds ?? (payload.messageId ? [payload.messageId] : [])) {
					const position = messageSeq(roomId, id)
					const seq = position > 0 ? position : sql.exec<{ seq: number }>("SELECT seq FROM messages WHERE room_id = ? AND id = ?", roomId, id).toArray()[0]?.seq
					if (seq !== undefined) dirty.add(seq)
				}
			}
		} else {
			sql.exec("DELETE FROM messages_fts WHERE messages_fts MATCH ?", `room:${roomToken}`)
		}
		const indexed = dirty.size ? sql.exec<Chunk>(
			"SELECT rowid, chunk, members, edit_seq FROM messages_fts WHERE messages_fts MATCH ?",
			`room:${roomToken} AND room:(${[...dirty].map((seq) => `s${seq}`).join(" OR ")})`,
		).toArray() : []
		const present = new Set<number>()
		const insert = (rows: IndexedMessage[]) => {
			if (!rows.length) return
			let chunk = ""
			let bytes = 0
			let members: Member[] = []
			let boundary = `kikoboundary${crypto.randomUUID().replaceAll("-", "")}`
			while (rows.some((row) => row.text.toLowerCase().includes(boundary))) boundary += "x"
			const separator = `\n${boundary}\n`
			const encoder = new TextEncoder()
			const flush = () => {
				const first = members[0]
				const last = members.at(-1)
				if (!first || !last) return
				sql.exec(
					"INSERT INTO messages_fts (room, chunk, room_id, first_seq, last_seq, edit_seq, members) VALUES (?, ?, ?, ?, ?, ?, ?)",
					`${roomToken} ${members.map(([seq]) => `s${seq}`).join(" ")}`, chunk, roomId, first[0], last[0], editSeq, JSON.stringify(members),
				)
				chunk = ""
				bytes = 0
				members = []
			}
			for (const row of rows) {
				const length = encoder.encode(row.text).length
				if (members.length && (members.length >= MAX_CHUNK_MESSAGES || bytes + separator.length + length > MAX_CHUNK_BYTES)) flush()
				if (members.length) {
					chunk += separator
					bytes += separator.length
				}
				const start = chunk.length
				chunk += row.text
				bytes += length
				members.push([row.seq, start, chunk.length])
			}
			flush()
		}
		for (const doc of indexed) {
			const members = JSON.parse(doc.members) as Member[]
			for (const [seq] of members) present.add(seq)
			const rows = sql.exec<IndexedMessage>(
				"SELECT seq, text FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL ORDER BY seq",
				roomId, JSON.stringify(members.map(([seq]) => seq)),
			).toArray()
			sql.exec("DELETE FROM messages_fts WHERE rowid = ?", doc.rowid)
			insert(rows)
		}
		const current = sql.exec<IndexedMessage>(
			"SELECT seq, text FROM messages WHERE room_id = ? AND seq > ? AND deleted_at IS NULL ORDER BY seq", roomId, state?.last_seq ?? 0,
		).toArray()
		if (hydrated.length) current.push(...sql.exec<IndexedMessage>(
			"SELECT seq, text FROM messages WHERE room_id = ? AND seq IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL ORDER BY seq", roomId, JSON.stringify(hydrated.map((row) => row.seq)),
		).toArray())
		insert(current.filter((row) => !present.has(row.seq)).sort((a, b) => a.seq - b.seq))
		sql.exec("INSERT INTO owner_meta (scope, key, value) VALUES (?, 'search-state', ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", scope, JSON.stringify({ last_seq: Math.max(lastSeq, state?.last_seq ?? 0), edit_seq: editSeq }))
		if (hydrated.length) sql.exec("DELETE FROM owner_meta WHERE scope = ? AND key >= 'search-hydrated:' AND key < 'search-hydrated;'", scope)
	})
}

function matchingMembers(storage: DurableObjectStorage, doc: Chunk, terms: string[]): Set<number> {
	const members = JSON.parse(doc.members) as Member[]
	let matches = new Set(members.map(([seq]) => seq))
	let marker = "\u0001"
	while (doc.chunk.includes(marker)) marker += "\u0001"
	const open = `${marker}o${marker}`
	const close = `${marker}c${marker}`
	for (const term of terms) {
		const marked = storage.sql.exec<{ marked: string }>(
			"SELECT highlight(messages_fts, 1, ?, ?) AS marked FROM messages_fts WHERE rowid = ? AND messages_fts MATCH ?",
			open, close, doc.rowid, `chunk:(${term})`,
		).toArray()[0]?.marked
		if (marked === undefined) return new Set()
		const hits = new Set<number>()
		let cursor = 0
		let offset = 0
		let member = 0
		while (cursor < marked.length) {
			const start = marked.indexOf(open, cursor)
			if (start < 0) break
			offset += start - cursor
			const end = marked.indexOf(close, start + open.length)
			if (end < 0) break
			const length = end - start - open.length
			while ((members[member]?.[2] ?? Number.POSITIVE_INFINITY) <= offset) member++
			const range = members[member]
			if (range && offset >= range[1] && offset + length <= range[2]) hits.add(range[0])
			offset += length
			cursor = end + close.length
		}
		matches = new Set([...matches].filter((seq) => hits.has(seq)))
		if (!matches.size) break
	}
	return matches
}

export function searchMessages(storage: DurableObjectStorage, roomId: string, query: string, options: SearchOptions = {}): SearchPage {
	const words = queryWords(query)
	if (!words.length) return { results: [], next: null }
	const terms = words.map((word, index) => `"${word}"${index === words.length - 1 ? "*" : ""}`)
	const size = Math.min(Math.max(options.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
	const roomToken = `r${Array.from(new TextEncoder().encode(roomId), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
	indexChunks(storage, roomId, roomToken)
	const rows: ResultRow[] = []
	for (const doc of storage.sql.exec<Chunk & { first_seq: number; last_seq: number }>(
		`SELECT rowid, chunk, members, edit_seq, first_seq, last_seq FROM messages_fts
		 WHERE messages_fts MATCH ? AND room_id = ? AND first_seq < ? ORDER BY last_seq DESC`,
		`room:${roomToken} AND chunk:(${terms.join(" ")})`, roomId, options.before ?? Number.MAX_SAFE_INTEGER,
	).toArray()) {
		const extra = rows[size]
		if (extra && doc.last_seq < extra.seq) break
		const matches = matchingMembers(storage, doc, terms)
		if (!matches.size) continue
		rows.push(...storage.sql.exec<ResultRow>(
			`SELECT id, seq, at, sender, text, rich FROM messages
			 WHERE room_id = ? AND seq BETWEEN ? AND ? AND seq IN (SELECT value FROM json_each(?))
			 AND seq < ? AND at < ? AND deleted_at IS NULL
			 AND (event IS NULL OR json_extract(event, '$.private') IS NOT 1)${options.mail ? "" : " AND addressed IS NULL"}
			 ORDER BY seq DESC LIMIT ?`,
			roomId, doc.first_seq, doc.last_seq, JSON.stringify([...matches]),
			options.before ?? Number.MAX_SAFE_INTEGER, options.beforeAt ?? Number.MAX_SAFE_INTEGER, size + 1,
		).toArray())
		rows.sort((a, b) => b.seq - a.seq)
		rows.length = Math.min(rows.length, size + 1)
	}
	const page = rows.slice(0, size)
	return {
		results: page.map((r) => ({ id: r.id as MessageId, seq: r.seq, at: r.at, from: JSON.parse(r.sender) as Sender, snippet: snippetOf(r.rich ? plainText(JSON.parse(r.rich) as RichText) : r.text, query) })),
		next: rows.length > size ? (page[page.length - 1]?.seq ?? null) : null,
	}
}
