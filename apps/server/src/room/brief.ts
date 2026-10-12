import { escapeXml } from "@yuki/agent/text"
import type { Task } from "@yuki/protocol"
import { MAX_ROLE, type MemberRow } from "./members"
import { briefTasks } from "./workspace"

const MAX_LINE = 400
/** The most of a member's doing text one brief names, in characters. A command's text is cut here. */
const MAX_DOING = 80
/** The most of the human's handle one brief names, in characters. */
const MAX_HANDLE = 40
/**
 * The most of the board one brief carries. A human message rides with its brief in one inbox entry
 * of 128 KB. Its bubble is at most 64 KB of JSON (`whole-text.ts`), so the board takes 24 KB. Every
 * other part of the entry is capped too, and the worst case in `human-delivery.test.ts` measures the sum.
 */
export const MAX_BOARD_BYTES = 24 * 1024

export type BriefView = {
	goal: string
	members: readonly MemberRow[]
	tasks: readonly Task[]
	reactions: string | null
	team?: Record<string, { doing: string | null; holds: readonly string[] }>
	human?: string
	proposal?: string
}

const oneLine = (text: string, max = MAX_LINE) => {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > max ? escapeXml(`${flat.slice(0, max)}...`) : escapeXml(flat)
}

const HUMAN_HINT = (handle: string) => ` write @${handle} only when you need them, such as a question only they can answer.`

export function shortBrief(brief: string): string {
	return brief.replace(/^(the human is @(\S+)\.) write @\2 only when you need them, such as a question only they can answer\.$/m, "$1")
}

/** The most of a member's held paths one brief names, in bytes after escaping. A path is cut to `MAX_HOLD_PATH` characters, so one path always fits. */
const MAX_HOLDING_BYTES = 512
const MAX_HOLD_PATH = 96

function holding(paths: readonly string[]): string {
	const shown: string[] = []
	let bytes = 0
	for (const [i, p] of paths.entries()) {
		const cut = p.length > MAX_HOLD_PATH ? `${p.slice(0, MAX_HOLD_PATH)}...` : p
		const item = `/${escapeXml(cut)}`
		bytes += new TextEncoder().encode(item).length + 2
		if (bytes > MAX_HOLDING_BYTES) return [...shown, `and ${paths.length - i} more`].join(", ")
		shown.push(item)
	}
	return shown.join(", ")
}

/** The board's lines, up to `MAX_BOARD_BYTES`. The rest is counted, so the agent knows there is more. */
function boardLines(tasks: readonly Task[]): string[] {
	const lines: string[] = []
	let bytes = 0
	for (const [i, t] of tasks.entries()) {
		const line = `- ${t.id} [${t.status}] ${oneLine(t.title)}${t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : ""}`
		bytes += new TextEncoder().encode(line).length + 1
		if (bytes > MAX_BOARD_BYTES) return [...lines, `- and ${tasks.length - i} more on the board`]
		lines.push(line)
	}
	return lines
}

export function buildBrief(member: MemberRow, view: BriefView): string {
	const lines = [`room goal: ${oneLine(view.goal) || "none yet"}`, `you are @${member.slug}${member.lead ? ", the lead" : ""}.`]
	if (view.human) {
		const who = oneLine(view.human, MAX_HANDLE)
		lines.push(`the human is @${who}.${HUMAN_HINT(who)}`)
	}
	lines.push("members:")
	for (const m of view.members) {
		const now = m.slug === member.slug ? { doing: null, holds: [] } : view.team?.[m.slug]
		const parts = [
			m.lead ? "lead" : null,
			m.role ? oneLine(m.role, MAX_ROLE) : null,
			now?.doing ? `now ${oneLine(now.doing, MAX_DOING)}` : m.slug === member.slug ? null : m.status,
			now?.holds.length ? `holding ${holding(now.holds)}` : null,
		]
		lines.push(`- @${m.slug} (${escapeXml(m.name)}): ${parts.filter(Boolean).join(", ")}`)
	}
	lines.push("your tasks:")
	lines.push(...(view.tasks.length ? boardLines(view.tasks) : ["- none"]))
	if (view.proposal) lines.push(oneLine(view.proposal))
	if (view.reactions) lines.push(escapeXml(view.reactions))
	return lines.join("\n")
}

export function readBriefView(sql: SqlStorage, member: MemberRow, members: readonly MemberRow[], goal: string, reactions: string | null): BriefView {
	return { goal, members, tasks: briefTasks(sql, member.slug), reactions }
}

export function initiativeBrief(view: { owe: readonly string[]; related: readonly string[]; noticed?: readonly string[] }): string {
	const lines = [...view.owe.map((l) => `you owe: ${l}`), ...view.related.map((l) => `related: ${l}`), ...(view.noticed ?? []).map((l) => `on their plate: ${l}`)]
	if (!lines.length) return ""
	return [...lines, "bring a related line or something on their plate up only when it truly helps the human now, at most one, in passing. keep what you owe, or say why you cannot."].join("\n")
}
