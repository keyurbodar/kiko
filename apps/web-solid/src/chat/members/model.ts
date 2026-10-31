import { type Agent, type AgentSlug, type Member, type MemberOp, tagline } from "@kiko/protocol"

export function addable(agents: readonly Agent[], members: readonly Member[]): Agent[] {
  const here = new Set(members.map((m) => m.slug as string))
  return agents.filter((a) => !here.has(a.slug))
}

export function addOp(agent: Agent): MemberOp {
  const role = tagline(agent.prompt)
  return {
    op: "add",
    slug: agent.slug as AgentSlug,
    name: agent.name,
    ...(role ? { role } : {}),
    ...(agent.model ? { model: agent.model } : {}),
  }
}
