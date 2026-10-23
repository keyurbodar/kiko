import { type Agent, type AgentSlug, type Member, type MemberOp, type MemberRefusal, tagline } from "@kiko/protocol"

export function addable(agents: readonly Agent[], members: readonly Member[]): Agent[] {
  const here = new Set(members.map((m) => m.slug as string))
  return agents.filter((a) => !here.has(a.slug))
}

export function addOp(agent: Agent): MemberOp {
  const op: MemberOp = { op: "add", slug: agent.slug as AgentSlug, name: agent.name }
  const role = tagline(agent.prompt)
  if (role) op.role = role
  if (agent.model) op.model = agent.model
  return op
}

export function refusalText(op: MemberOp, reason: MemberRefusal): string {
  const who = "name" in op ? op.name : op.slug
  switch (reason) {
    case "limit":
      return "A group holds at most 8 agents"
    case "exists":
      return `${who} is already in this chat`
    case "unknown":
      return `${who} is not in this chat`
    case "last":
      return "A chat keeps at least one agent"
    case "reserved":
      return `@${op.slug} is a reserved handle`
    case "chief":
      return "Kiko leads every chat and stays in it"
    case "kiko":
      return "The Kiko chat stays with Kiko. Start a new group instead"
  }
}
