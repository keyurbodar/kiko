import { KIKO } from "@kiko/protocol"

/** What a person sees for an agent's handle: its name, and Kiko for the chief, who is not in the agent list. */
export function agentDisplayName(slug: string, agents: readonly { slug: string; name: string }[]): string {
  return slug === KIKO ? "Kiko" : (agents.find((a) => a.slug === slug)?.name ?? slug)
}
