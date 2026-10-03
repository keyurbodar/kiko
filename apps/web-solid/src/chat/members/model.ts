import { type Agent, type AgentSlug, type Member, type MemberOp, type MemberRefusal, tagline } from "@kiko/protocol"

/*
 * The pure part of a group's member list: who can be added, what an add sends, and what a
 * refusal says. The components hold only state.
 */

/** The user's agents that are not in the room yet, in the order the user made them. */
export function addable(agents: readonly Agent[], members: readonly Member[]): Agent[] {
  const here = new Set(members.map((m) => m.slug as string))
  return agents.filter((a) => !here.has(a.slug))
}

/** The frame that adds `agent`: its tagline for teammates and the model it was made with. Who it is lives in its soul. */
export function addOp(agent: Agent): MemberOp {
  const op: MemberOp = { op: "add", slug: agent.slug as AgentSlug, name: agent.name }
  const role = tagline(agent.prompt)
  if (role) op.role = role
  if (agent.model) op.model = agent.model
  return op
}

/** A rename that changes nothing sends nothing. */
export function renameOp(member: Member, name: string): MemberOp | null {
  const next = name.trim()
  return next && next !== member.name ? { op: "rename", slug: member.slug, name: next } : null
}

/** What the toast says when the room refuses a change. Lowercase, like every interface string. */
export function refusalText(op: MemberOp, reason: MemberRefusal): string {
  const who = "name" in op ? op.name.toLowerCase() : op.slug
  switch (reason) {
    case "limit":
      return "a group holds at most 8 agents"
    case "exists":
      return `${who} is already in this chat`
    case "unknown":
      return `${who} is not in this chat`
    case "last":
      return "a chat keeps at least one agent"
    case "reserved":
      return `@${op.slug} is a reserved handle`
  }
}

/** `lead`, or the agent's role cut to one line, or `agent`. */
export function roleLabel(member: Member): string {
  if (member.lead) return "lead"
  const role = member.role?.split("\n")[0]?.trim().toLowerCase()
  return role || "agent"
}
