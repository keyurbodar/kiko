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
