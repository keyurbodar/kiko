import type { Task } from "@yuki/protocol"
import type { MemberRow } from "./members"
import { briefTasks } from "./workspace"

// Architecture section 7.4. The workspace brief the room attaches to every delivery. The agent
// prepends it to its input as a `<context>` block, so the text is for a model to read. It holds the
// room goal, the members with what each is doing, the receiving member's tasks, and the reactions on
// its messages. What was said lives in the run's <memory> block (section 13), not here.

// ASSUMPTION: a goal or role is cut to this many characters in the brief.
const MAX_LINE = 400

export type BriefView = {
	/** ASSUMPTION: the chat title until the workspace stores a goal of its own. */
	goal: string
	members: readonly MemberRow[]
	/** The member's open tasks and the tasks that block them (workspace.ts). */
	tasks: readonly Task[]
	/** Reactions on the member's own messages since its last brief, as `reactionBrief` in reactions.ts writes them. */
	reactions: string | null
	/** What each member is doing right now and the paths it holds (team.ts, section 7.12). */
	team?: Record<string, { doing: string | null; holds: readonly string[] }>
	/** The human's handle, so the agent can @ them. Absent until the human's first socket. */
	human?: string
	/** yuki only: the proposal that waits for the human's answer (section 7.11). */
	proposal?: string
}

/** Message text is escaped, so it cannot close the `<context>` block or forge a tag (section 16.2). */
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const oneLine = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE)}...` : flat
}

/** The long half of the line naming the human. Only a run that starts fresh reads it (`shortBrief`). */
const HUMAN_HINT = (handle: string) => ` write @${handle} only when you need them, such as a question only they can answer.`

/** A brief without `HUMAN_HINT`, for a run whose transcript already has it. */
export function shortBrief(brief: string): string {
	return brief.replace(/^(the human is @(\S+)\.) write @\2 only when you need them, such as a question only they can answer\.$/m, "$1")
}

/** The brief for `member`. Pure: the room gathers the view from its tables. */
export function buildBrief(member: MemberRow, view: BriefView): string {
	const lines = [`room goal: ${oneLine(view.goal) || "none yet"}`, `you are @${member.slug}${member.lead ? ", the lead" : ""}.`]
	if (view.human) lines.push(`the human is @${view.human}.${HUMAN_HINT(view.human)}`)
	lines.push("members:")
	for (const m of view.members) {
		// What the agent itself is doing would only make each of its briefs differ from the last (section 7.4).
		const now = m.slug === member.slug ? { doing: null, holds: [] } : view.team?.[m.slug]
		const parts = [
			m.lead ? "lead" : null,
			m.role ? oneLine(m.role) : null,
			now?.doing ? `now ${now.doing}` : m.slug === member.slug ? null : m.status,
			now?.holds.length ? `holding ${now.holds.map((p) => `/${p}`).join(", ")}` : null,
		]
		lines.push(`- @${m.slug} (${m.name}): ${parts.filter(Boolean).join(", ")}`)
	}
	lines.push("your tasks:")
	if (view.tasks.length) for (const t of view.tasks) lines.push(`- ${t.id} [${t.status}] ${oneLine(t.title)}${t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : ""}`)
	else lines.push("- none")
	if (view.proposal) lines.push(escape(view.proposal))
	if (view.reactions) lines.push(escape(view.reactions))
	return lines.join("\n")
}

/** Reads the view for `member` from the room's tables. */
export function readBriefView(sql: SqlStorage, member: MemberRow, members: readonly MemberRow[], goal: string, reactions: string | null): BriefView {
	return { goal, members, tasks: briefTasks(sql, member.slug), reactions }
}
