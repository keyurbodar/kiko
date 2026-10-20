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

export type Origin = { kind: "you" } | { kind: "agent"; slug: string } | { kind: "chat"; title: string }

export function originOf(l: Pick<LifeLine, "source">): Origin {
	const source = (l.source || "@kiko").trim()
	if (source === "you") return { kind: "you" }
	if (source.startsWith("@")) return { kind: "agent", slug: source.slice(1) }
	return { kind: "chat", title: source.replace(/^chat\s+/i, "") }
}

export function ordered(lines: readonly LifeLine[]): { pinned: LifeLine[]; recent: LifeLine[] } {
	const live = lines.filter((l) => !l.redacted)
	return { pinned: live.filter((l) => l.pinned), recent: live.filter((l) => !l.pinned) }
}

export function matching(lines: readonly LifeLine[], query: string): LifeLine[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	return lines.filter((l) => !l.redacted && words.every((w) => l.text.toLowerCase().includes(w)))
}

export function mergeResults(local: readonly LifeLine[], remote: readonly LifeLine[] | null): LifeLine[] {
	const seen = new Set(local.map((l) => l.pos))
	return [...local, ...(remote ?? []).filter((l) => !seen.has(l.pos))]
}
