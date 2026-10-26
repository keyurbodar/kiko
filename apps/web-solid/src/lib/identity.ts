import { FLAVOURS, resolve } from "@kiko/avatar"
import { KIKO } from "@kiko/protocol"
import { pinsFor } from "../avatar/picks"

export type IdentityLook = {
  seed: string
  color: string
}

export function identityLook(seed: string): IdentityLook {
  return { seed, color: inkColor(seed) }
}

function inkColor(seed: string): string {
  if (seed === KIKO) return "var(--info)"
  const grain = FLAVOURS[resolve(seed, pinsFor(seed)).flavour].grain
  return `light-dark(color-mix(in oklch, ${grain}, #000 45%), color-mix(in oklch, ${grain}, #fff 30%))`
}

const DEFAULT_AGENT_SLUG = KIKO

type ChatAgents = { roomId: string; agents?: readonly string[] }
type AgentIds = readonly { id: string; slug: string }[]

const slugOf = (id: string, agents: AgentIds) => agents.find((a) => a.id === id)?.slug ?? id

const MAX_FACES = 3

export function chatFaces(chat: ChatAgents, agents: AgentIds): string[] {
  let slugs = (chat.agents ?? []).map((id) => slugOf(id, agents))
  if (slugs.length > 1 && !slugs.includes(DEFAULT_AGENT_SLUG)) slugs = [DEFAULT_AGENT_SLUG, ...slugs]
  if (slugs.length > 1) return slugs.slice(0, MAX_FACES)
  return [slugs[0] ?? DEFAULT_AGENT_SLUG]
}
