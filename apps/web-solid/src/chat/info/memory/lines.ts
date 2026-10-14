import type { LifeLine } from "@kiko/protocol"

export function ago(at: number, now = Date.now()): string {
	const s = Math.max(0, (now - at) / 1000)
	if (s < 60) return "now"
	if (s < 3600) return `${Math.floor(s / 60)}m`
	if (s < 86400) return `${Math.floor(s / 3600)}h`
	if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function replacedMark(l: Pick<LifeLine, "supersededBy">): string | null {
	return l.supersededBy != null ? "Replaced" : null
}

/** Where a memory came from, as a heading: the chat's name without the `chat ` prefix. */
export function sourceOf(l: Pick<LifeLine, "source">): string {
	return (l.source || "Kiko").replace(/^chat\s+/i, "")
}

/** Pinned lines first, then one group per source, newest group first. Order inside a group is kept. */
export function groupLines(lines: readonly LifeLine[]): { title: string; lines: LifeLine[] }[] {
	const pinned = lines.filter((l) => l.pinned && !l.redacted)
	const groups = new Map<string, LifeLine[]>()
	for (const l of lines) {
		if (l.redacted || l.pinned) continue
		const key = sourceOf(l)
		groups.set(key, [...(groups.get(key) ?? []), l])
	}
	const rest = [...groups].map(([title, ls]) => ({ title, lines: ls })).sort((a, b) => Math.max(...b.lines.map((l) => l.at)) - Math.max(...a.lines.map((l) => l.at)))
	return pinned.length ? [{ title: "Pinned", lines: pinned }, ...rest] : rest
}
