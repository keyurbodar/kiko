// Pure helpers for the memory list. A table of type order and labels, and functions
// that turn records into what the list shows. No Solid in here, so a test can run them.

import type { MemoryRecord, MemoryType } from "@kiko/protocol"

/** The order groups appear in, with the label each shows. */
export const GROUPS: readonly { type: MemoryType; label: string }[] = [
	{ type: "profile", label: "profile" },
	{ type: "now", label: "now" },
	{ type: "todo", label: "todo" },
	{ type: "preference", label: "preferences" },
	{ type: "person", label: "people" },
	{ type: "organization", label: "organizations" },
	{ type: "procedure", label: "procedures" },
	{ type: "conversation", label: "conversations" },
]

export type Group = { key: string; label: string; records: MemoryRecord[] }

/** True when every word of the query is in the title, an alias, or the body. */
export function matches(record: MemoryRecord, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (!words.length) return true
	const haystack = `${record.title}\n${record.aliases.join("\n")}\n${record.body}`.toLowerCase()
	return words.every((w) => haystack.includes(w))
}

/**
 * Groups by type in table order. Pinned records come first inside a group, then the most
 * recently changed. Archived records go in one last group.
 */
export function groupRecords(records: readonly MemoryRecord[], query = ""): Group[] {
	const live = records.filter((r) => !r.archived && matches(r, query))
	const order = (a: MemoryRecord, b: MemoryRecord) =>
		Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
	const groups: Group[] = []
	for (const { type, label } of GROUPS) {
		const inGroup = live.filter((r) => r.type === type).sort(order)
		if (inGroup.length) groups.push({ key: type, label, records: inGroup })
	}
	const archived = records.filter((r) => r.archived && matches(r, query)).sort(order)
	if (archived.length) groups.push({ key: "archived", label: "archived", records: archived })
	return groups
}

/** A piece of a record body: plain text, or a `[[id]]` link. */
export type Piece = { text: string } | { link: string }

const LINK = /\[\[([a-z0-9][a-z0-9-]{0,63})\]\]/g

/** Splits text at every `[[id]]`. */
export function splitLinks(text: string): Piece[] {
	const pieces: Piece[] = []
	let last = 0
	for (const m of text.matchAll(LINK)) {
		if (m.index > last) pieces.push({ text: text.slice(last, m.index) })
		pieces.push({ link: m[1] })
		last = m.index + m[0].length
	}
	if (last < text.length) pieces.push({ text: text.slice(last) })
	return pieces
}

export type Block = { kind: "bullet" | "paragraph" | "heading"; text: string }

/** Lines of markdown as blocks. Only what memory bodies hold: headings, bullets, text. */
export function parseBody(body: string): Block[] {
	const blocks: Block[] = []
	for (const raw of body.split("\n")) {
		const line = raw.trimEnd()
		if (!line.trim()) continue
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
		const heading = /^#{1,6}\s+(.*)$/.exec(line)
		if (bullet) blocks.push({ kind: "bullet", text: bullet[1] })
		else if (heading) blocks.push({ kind: "heading", text: heading[1] })
		else blocks.push({ kind: "paragraph", text: line })
	}
	return blocks
}

/** A short line for the list: the first fact, without its bullet or date. */
export function snippet(record: MemoryRecord): string {
	const first = parseBody(record.body)[0]
	if (!first) return ""
	return first.text.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "").replace(/\s*\((human|agent|[a-z0-9-]+ agent)\)\s*$/i, "").slice(0, 90)
}

/**
 * The records the chat info panel shows first. ASSUMPTION: a record keeps no chat of its
 * own, so "this chat created or used most" is read as: the record names the chat, or the
 * agent has used it a lot. Pinned records lead, then the ones that name the chat, then the
 * most used.
 */
export function forChat(records: readonly MemoryRecord[], chatName: string, max = 4): MemoryRecord[] {
	const name = chatName.trim().toLowerCase()
	const names = (r: MemoryRecord) => name.length > 2 && `${r.title}\n${r.body}`.toLowerCase().includes(name)
	return records
		.filter((r) => !r.archived)
		.map((r) => ({ r, score: Number(r.pinned) * 1000 + Number(names(r)) * 500 + r.uses }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || b.r.updatedAt - a.r.updatedAt || a.r.id.localeCompare(b.r.id))
		.slice(0, max)
		.map((x) => x.r)
}

export type Fact = { text: string; date: string | null; author: string | null }

/** A body line as a fact: `2026-09-03: likes tea (human)` becomes the text, the date, and who wrote it. */
export function fact(line: string): Fact {
	const dated = /^(\d{4}-\d{2}-\d{2}):\s*(.*)$/.exec(line)
	const rest = dated ? dated[2] : line
	const by = /^(.*?)\s*\(([a-z0-9 -]{1,32})\)\s*$/i.exec(rest)
	return { text: by ? by[1] : rest, date: dated ? dated[1] : null, author: by ? by[2] : null }
}
