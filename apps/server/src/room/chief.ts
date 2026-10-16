import { type Agent, type AgentSlug, isAgentSlug, tagline } from "@kiko/protocol"
import { MAX_CHAT } from "../files/room-fs"
import { MAX_SOUL } from "../user/souls"

export const CHIEF = "kiko" as AgentSlug

export type NewAgentSpec = { name: string; handle: string; description: string; soul: string }

export type GroupInput = { title: string; members: readonly string[]; newAgents: readonly NewAgentSpec[]; goal: string; kickoff: string }

const MAX_NEW_AGENTS = 4
const MAX_MEMBERS = 7
const MAX_KICKOFF = 4_000

const clean = (s: string, max: number) => s.trim().slice(0, max)
const handleOf = (s: string) => s.trim().toLowerCase().replace(/^@/, "")
/** A name begins with a capital, so a model that writes "ebert" still makes Ebert. */
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Tracks the handles and names a batch of new agents must not reuse. */
function newAgentCheck(agents: readonly Agent[]) {
  const taken = new Set([CHIEF, ...agents.map((a) => a.slug as string)])
  const names = new Set(["kiko", ...agents.map((a) => a.name.trim().toLowerCase())])
  return (a: NewAgentSpec): NewAgentSpec | { error: string } => {
    const handle = handleOf(a.handle)
    const name = capitalized(clean(a.name, 60))
    if (!name) return { error: "every new agent needs a name" }
    if (names.has(name.toLowerCase())) return { error: `an agent named ${name} already exists. pick another name, or use that agent` }
    if (!isAgentSlug(handle)) return { error: `"${a.handle}" is not a usable handle: lowercase letters, digits, and dashes` }
    if (taken.has(handle)) return { error: `@${handle} is taken. pick another handle` }
    if (!a.soul.trim()) return { error: `@${handle} needs a soul` }
    if (a.soul.length > MAX_SOUL) return { error: `@${handle}'s soul is ${a.soul.length} characters; it holds ${MAX_SOUL}. tighten it` }
    taken.add(handle)
    names.add(name.toLowerCase())
    const description = clean(a.description, 200) || tagline(a.soul.replace(/^#.*\n+/, ""))
    return { name, handle, description, soul: `${a.soul.trim()}\n` }
  }
}

export function checkNewAgent(spec: NewAgentSpec, agents: readonly Agent[]): NewAgentSpec | { error: string } {
  return newAgentCheck(agents)(spec)
}

/** `creator` is the agent making the group. Kiko is always in a group and the creator is too, so neither counts as a pick. */
export function checkGroup(input: GroupInput, creator: AgentSlug, agents: readonly Agent[]): GroupInput | { error: string } {
  const title = clean(input.title, 200)
  if (!title) return { error: "the group needs a title" }
  const kickoff = clean(input.kickoff, MAX_KICKOFF)
  if (!kickoff) return { error: "the group needs a kickoff: your first message to everyone in it" }
  const members = [...new Set(input.members.map(handleOf).filter((m) => m && m !== CHIEF && m !== creator))]
  const unknown = members.filter((m) => !agents.some((a) => a.slug === m))
  if (unknown.length) return { error: `no agent ${unknown.map((m) => `@${m}`).join(", ")}. the human has: ${agents.map((a) => `@${a.slug}`).join(", ") || "no agents yet"}` }
  if (input.newAgents.length && creator !== CHIEF) return { error: "only kiko makes new agents. pick from list_agents, or ask kiko to make one" }
  if (input.newAgents.length > MAX_NEW_AGENTS) return { error: `make at most ${MAX_NEW_AGENTS} new agents at once` }
  const check = newAgentCheck(agents)
  const newAgents: NewAgentSpec[] = []
  for (const a of input.newAgents) {
    const out = check(a)
    if ("error" in out) return out
    newAgents.push(out)
  }
  if (members.length + newAgents.length === 0) return { error: "a group needs at least one agent besides you and kiko" }
  if (members.length + newAgents.length + (creator === CHIEF ? 0 : 1) > MAX_MEMBERS) return { error: `a group holds ${MAX_MEMBERS} agents besides kiko` }
  return { title, members, newAgents, goal: input.goal.trim(), kickoff }
}

/** /chat.md for a new group: the goal, who does what, and an empty decisions section. */
export function groupChatFile(title: string, goal: string, team: readonly { slug: string; role: string }[]): string | { error: string } {
  const lines = team.map((m) => `- @${m.slug}: ${m.role}`.trimEnd()).join("\n")
  const text = `# ${title}\n\ngoal: ${goal}\n\n## who does what\n${lines}\n\n## decisions\n`
  return new TextEncoder().encode(text).length > MAX_CHAT ? { error: `/chat.md holds ${MAX_CHAT} bytes. tighten the goal` } : text
}

export function introduction(spec: NewAgentSpec): string {
  return `kiko just made you for the human: ${spec.description}. this is your own chat with them. say hi in a line, in your voice, and ask what to start with.`
}
