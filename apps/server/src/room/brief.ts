import { escapeXml } from "@yuki/agent/text"
import type { Task } from "@yuki/protocol"
import type { MemberRow } from "./members"
import { briefTasks } from "./workspace"

const MAX_LINE = 400

export type BriefView = {
	goal: string
	members: readonly MemberRow[]
	tasks: readonly Task[]
	reactions: string | null
	team?: Record<string, { doing: string | null; holds: readonly string[] }>
	human?: string
	proposal?: string
}

const oneLine = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > MAX_LINE ? escapeXml(`${flat.slice(0, MAX_LINE)}...`) : escapeXml(flat)
}

const HUMAN_HINT = (handle: string) => ` write @${handle} only when you need them, such as a question only they can answer.`

export function shortBrief(brief: string): string {
	return brief.replace(/^(the human is @(\S+)\.) write @\2 only when you need them, such as a question only they can answer\.$/m, "$1")
}

export function buildBrief(member: MemberRow, view: BriefView): string {
	const lines = [`room goal: ${oneLine(view.goal) || "none yet"}`, `you are @${member.slug}${member.lead ? ", the lead" : ""}.`]
	if (view.human) lines.push(`the human is @${view.human}.${HUMAN_HINT(view.human)}`)
	lines.push("members:")
	for (const m of view.members) {
		const now = m.slug === member.slug ? { doing: null, holds: [] } : view.team?.[m.slug]
		const parts = [
			m.lead ? "lead" : null,
			m.role ? oneLine(m.role) : null,
			now?.doing ? `now ${escapeXml(now.doing)}` : m.slug === member.slug ? null : m.status,
			now?.holds.length ? `holding ${now.holds.map((p) => `/${escapeXml(p)}`).join(", ")}` : null,
		]
		lines.push(`- @${m.slug} (${escapeXml(m.name)}): ${parts.filter(Boolean).join(", ")}`)
	}
	lines.push("your tasks:")
	if (view.tasks.length) for (const t of view.tasks) lines.push(`- ${t.id} [${t.status}] ${oneLine(t.title)}${t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : ""}`)
	else lines.push("- none")
	if (view.proposal) lines.push(escapeXml(view.proposal))
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
