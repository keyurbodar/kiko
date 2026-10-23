import type { Actor, Sender } from "@kiko/protocol"

export function actorKey(who: Sender): string {
  if (who.kind === "human") return "human"
  return who.kind === "agent" ? `agent:${who.slug}` : `system:${who.reason}`
}

export function actorFromKey(key: string): Actor {
  return key === "human" ? { kind: "human" } : ({ kind: "agent", slug: key.slice("agent:".length) } as Actor)
}
