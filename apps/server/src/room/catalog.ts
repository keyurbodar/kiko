import type { CatalogItem, FileRef, MessageId } from "@kiko/protocol"

// The links and the media sent in one room, for the chat info panel. They are read from the
// stored messages, newest first, and paged by message `seq`. A page always holds whole
// messages, so a message with three links is never split across two pages.
// ASSUMPTION: media is what messages attach. A file only in the workspace index is not
// media: the files section lists it.

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const BATCH = 100
const MAX_LINKS_PER_MESSAGE = 20

export type CatalogPage = { items: CatalogItem[]; next: number | null }

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g

/** The http(s) links in a text, in order, without trailing punctuation. Repeats are dropped. */
export function extractLinks(text: string): { url: string; site: string }[] {
	const seen = new Set<string>()
	const out: { url: string; site: string }[] = []
	for (const match of text.matchAll(URL_PATTERN)) {
		let raw = match[0]
		// Trailing punctuation belongs to the sentence. A closing bracket stays only when the link opened one.
		for (;;) {
			const last = raw.at(-1)
			if (last && ".,;:!?*_".includes(last)) raw = raw.slice(0, -1)
			else if (last === ")" && !raw.includes("(")) raw = raw.slice(0, -1)
			else break
		}
		let parsed: URL
		try {
			parsed = new URL(raw)
		} catch {
			continue
		}
		if (!parsed.hostname) continue
		const url = parsed.href
		if (seen.has(url)) continue
		seen.add(url)
		out.push({ url, site: parsed.hostname.replace(/^www\./, "") })
		if (out.length >= MAX_LINKS_PER_MESSAGE) break
	}
	return out
}

const isMedia = (f: FileRef) => f.type.startsWith("image/") || f.type.startsWith("video/")

type Row = { id: string; seq: number; at: number; text: string; files: string | null }

/** Live messages' links or media, newest first. `before` is a seq: only older messages count. */
export function listCatalog(sql: SqlStorage, kind: "links" | "media", before?: number, limit?: number): CatalogPage {
	const size = Math.min(Math.max(limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
	const filter = kind === "links" ? "(text LIKE '%http://%' OR text LIKE '%https://%')" : "files IS NOT NULL"
	const items: CatalogItem[] = []
	let cursor = before ?? Number.MAX_SAFE_INTEGER
	while (true) {
		const rows = sql
			.exec<Row>(
				`SELECT id, seq, at, text, files FROM messages WHERE deleted_at IS NULL AND ${filter} AND seq < ? ORDER BY seq DESC LIMIT ?`,
				cursor,
				BATCH,
			)
			.toArray()
		for (const row of rows) {
			cursor = row.seq
			const id = row.id as MessageId
			if (kind === "links") {
				for (const link of extractLinks(row.text)) items.push({ kind: "link", ...link, messageId: id, seq: row.seq, at: row.at })
			} else {
				for (const file of (JSON.parse(row.files ?? "[]") as FileRef[]).filter(isMedia)) {
					items.push({ kind: "media", file, messageId: id, seq: row.seq, at: row.at })
				}
			}
			if (items.length >= size) {
				// More exists when an older matching message does.
				const more = sql
					.exec<{ n: number }>(`SELECT 1 AS n FROM messages WHERE deleted_at IS NULL AND ${filter} AND seq < ? LIMIT 1`, row.seq)
					.toArray()
				return { items, next: more.length ? row.seq : null }
			}
		}
		if (rows.length < BATCH) return { items, next: null }
	}
}
