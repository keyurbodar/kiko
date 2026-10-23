import { escapeXml } from "@kiko/agent/text"
import type { Task } from "@kiko/protocol"
import { MAX_ROLE, type MemberRow } from "./members"
import { briefTasks } from "./workspace"

const MAX_LINE = 400
const MAX_DOING = 80
const MAX_HANDLE = 40
const MAX_BOARD_BYTES = 24 * 1024

export type BriefView = {
  goal: string
  members: readonly MemberRow[]
  tasks: readonly Task[]
  reactions: string | null
  team?: Record<string, { doing: string | null; holds: readonly string[] }>
  human?: string
}

const oneLine = (text: string, max = MAX_LINE) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? escapeXml(`${flat.slice(0, max)}...`) : escapeXml(flat)
}

const HUMAN_HINT = (handle: string) =>
  ` write @${handle} only when you need them, such as a question only they can answer.`

export function shortBrief(brief: string): string {
  return brief.replace(
    /^(the human is @(\S+)\.) write @\2 only when you need them, such as a question only they can answer\.$/m,
    "$1",
  )
}

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

function boardLines(tasks: readonly Task[]): string[] {
  const lines: string[] = []
  let bytes = 0
  for (const [i, t] of tasks.entries()) {
    const line = `- ${t.id} [${t.status}] ${oneLine(t.title)}${t.owner ? ` (owner @${t.owner})` : ""}${t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : ""}`
    bytes += new TextEncoder().encode(line).length + 1
    if (bytes > MAX_BOARD_BYTES) return [...lines, `- and ${tasks.length - i} more on the board`]
    lines.push(line)
  }
  return lines
}

export function buildBrief(member: MemberRow, view: BriefView): string {
  const lines = [
    `room goal: ${oneLine(view.goal) || "none yet"}`,
    `you are @${member.slug}${member.lead ? ", the lead" : ""}.`,
  ]
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
  lines.push(member.lead ? "room tasks:" : "your tasks:")
  lines.push(...(view.tasks.length ? boardLines(view.tasks) : ["- none"]))
  if (view.reactions) lines.push(escapeXml(view.reactions))
  return lines.join("\n")
}

export function readBriefView(
  sql: SqlStorage,
  member: MemberRow,
  members: readonly MemberRow[],
  goal: string,
  reactions: string | null,
  roomId: string,
): BriefView {
  return { goal, members, tasks: briefTasks(sql, member.slug, roomId, member.lead), reactions }
}
