import type { ChatSearchHit } from "./room"

// Message search helpers the room, the Worker, and the client share. Architecture section 9.2.

/** Marks the start of a matched word in `SearchHit.snippet`. */
export const SNIPPET_OPEN = "\u0002"
/** Marks the end of a matched word in `SearchHit.snippet`. */
export const SNIPPET_CLOSE = "\u0003"

export type SnippetPart = { text: string; match: boolean }

/** Splits a marked snippet into plain and matched runs, in order. Empty runs are dropped. */
export function snippetParts(snippet: string): SnippetPart[] {
	const parts: SnippetPart[] = []
	let match = false
	let text = ""
	const flush = () => {
		if (!text) return
		const last = parts[parts.length - 1]
		if (last && last.match === match) last.text += text
		else parts.push({ text, match })
		text = ""
	}
	for (const ch of snippet) {
		if (ch === SNIPPET_OPEN || ch === SNIPPET_CLOSE) {
			flush()
			match = ch === SNIPPET_OPEN
		} else text += ch
	}
	flush()
	return parts
}

/** A snippet without its marks. */
export const snippetText = (snippet: string) => snippetParts(snippet).map((p) => p.text).join("")

/**
 * Merges per-chat pages, each newest first, into one page of at most `limit`, newest first. Scores
 * from different rooms' indexes are not comparable, so the order is by time, as Telegram's global
 * search is; ties go by room id, then seq, so the order never changes between calls. `next` is the
 * time of the last hit when any chat may have more, else null.
 */
export function mergeHits(
	pages: readonly { results: readonly ChatSearchHit[]; more: boolean }[],
	limit: number,
): { results: ChatSearchHit[]; next: number | null } {
	const all = pages.flatMap((p) => p.results)
	all.sort((a, b) => b.at - a.at || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0) || b.seq - a.seq)
	const results = all.slice(0, limit)
	const more = all.length > limit || pages.some((p) => p.more)
	return { results, next: more && results.length ? results[results.length - 1]!.at : null }
}
