import { KIKO } from "@kiko/protocol"

export function agentDisplayName(slug: string, agents: readonly { slug: string; name: string }[]): string {
  return slug === KIKO ? "Kiko" : (agents.find((a) => a.slug === slug)?.name ?? slug)
}
