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
	return first.text.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "").slice(0, 90)
}
