import type { Agent, AgentSlug } from "@kiko/protocol"

/*
 * The pure part of the new chat flow: what the list shows, what a handle
 * defaults to, and what the chat is called. The component holds only state.
 */

/** The agent every user has. It is not stored, so it is never missing. */
export const BUILTIN_AGENT: Agent = { id: "kiko", name: "kiko", slug: "kiko" as AgentSlug, prompt: "", model: "" }

/** The user's agents with the built-in one first. */
export function agentList(stored: readonly Agent[]): Agent[] {
  return [BUILTIN_AGENT, ...stored.filter((a) => a.id !== BUILTIN_AGENT.id)]
}

/** Agents whose name or handle holds every word of `query`. A leading `@` is ignored. */
export function filterAgents(agents: readonly Agent[], query: string): Agent[] {
  const words = query.toLowerCase().replace(/@/g, "").split(/\s+/).filter(Boolean)
  return agents.filter((a) => {
    const haystack = `${a.name} ${a.slug}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

/** A handle from a name: lowercase letters, digits, and dashes, at most 32 characters. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")
}

export const isHandle = (value: string): boolean => /^[a-z0-9-]{1,32}$/.test(value)

/** The handle as typed: stray `@` and capitals dropped, nothing else invented. */
export function cleanHandle(value: string): string {
  return value.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9-]/g, "").slice(0, 32)
}

/** The chat's title. A typed group name wins. Otherwise the picked names, in order. */
export function chatTitle(picked: readonly Agent[], groupName: string): string {
  const typed = groupName.trim().toLowerCase()
  if (picked.length > 1 && typed) return typed
  return picked.map((a) => a.name.toLowerCase()).join(", ")
}

export type NewAgentInput = { name: string; handle: string; prompt: string; model: string }

/** Why the form cannot be submitted yet, or null. */
export function agentProblem(input: NewAgentInput, existing: readonly Agent[]): string | null {
  if (!input.name.trim()) return "give it a name"
  if (!isHandle(input.handle)) return "a handle is letters, digits, and dashes"
  if (existing.some((a) => a.slug === input.handle)) return "that handle is taken"
  return null
}
