import type { Agent, AgentSlug } from "@kiko/protocol"

/*
 * The pure part of the new chat flow: who the human can message. Agents are made by kiko
 * (architecture section 7.11), so there is no form here.
 */

/** The agent every user has. It is not stored, so it is never missing. */
export const BUILTIN_AGENT: Agent = { id: "kiko", name: "kiko", slug: "kiko" as AgentSlug, prompt: "", model: "" }

/** The user's agents with the built-in one first. */
export function agentList(stored: readonly Agent[]): Agent[] {
  return [BUILTIN_AGENT, ...stored.filter((a) => a.id !== BUILTIN_AGENT.id)]
}
