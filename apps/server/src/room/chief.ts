import { type Agent, type AgentSlug, isAgentSlug, tagline } from "@yuki/protocol"
import { MAX_CHAT } from "../files/room-fs"
import { MAX_SOUL } from "../user/souls"

export const CHIEF = "yuki" as AgentSlug

export type NewAgentSpec = { name: string; handle: string; description: string; soul: string }

export type ProposalInput =
  | { kind: "agent"; agent: NewAgentSpec }
  | { kind: "group"; title: string; members: readonly string[]; agents: readonly NewAgentSpec[]; chat: string }

export type Proposal = ProposalInput & { id: string; seq: number }

const MAX_NEW_AGENTS = 4
const MAX_MEMBERS = 7

const clean = (s: string, max: number) => s.trim().slice(0, max)

export function checkProposal(input: ProposalInput, agents: readonly Agent[]): ProposalInput | { error: string } {
  const taken = new Set([CHIEF, ...agents.map((a) => a.slug as string)])
  const checkAgent = (a: NewAgentSpec): NewAgentSpec | string => {
    const handle = a.handle.trim().toLowerCase().replace(/^@/, "")
    const name = clean(a.name, 60)
    if (!name) return "every new agent needs a name"
    if (!isAgentSlug(handle)) return `"${a.handle}" is not a usable handle: lowercase letters, digits, and dashes`
    if (taken.has(handle)) return `@${handle} is taken. pick another handle`
    if (!a.soul.trim()) return `@${handle} needs a soul`
    if (a.soul.length > MAX_SOUL) return `@${handle}'s soul is ${a.soul.length} characters; it holds ${MAX_SOUL}. tighten it`
    taken.add(handle)
    const description = clean(a.description, 200) || tagline(a.soul.replace(/^#.*\n+/, ""))
    return { name, handle, description, soul: `${a.soul.trim()}\n` }
  }
  if (input.kind === "agent") {
    const agent = checkAgent(input.agent)
    return typeof agent === "string" ? { error: agent } : { kind: "agent", agent }
  }
  const title = clean(input.title, 200)
  if (!title) return { error: "the group needs a title" }
  const members = [...new Set(input.members.map((m) => m.trim().toLowerCase().replace(/^@/, "")).filter((m) => m && m !== CHIEF))]
  const unknown = members.filter((m) => !agents.some((a) => a.slug === m))
  if (unknown.length) return { error: `no agent ${unknown.map((m) => `@${m}`).join(", ")}. the human has: ${agents.map((a) => `@${a.slug}`).join(", ") || "no agents yet"}` }
  if (input.agents.length > MAX_NEW_AGENTS) return { error: `make at most ${MAX_NEW_AGENTS} new agents at once` }
  const made: NewAgentSpec[] = []
  for (const a of input.agents) {
    const out = checkAgent(a)
    if (typeof out === "string") return { error: out }
    made.push(out)
  }
  if (members.length + made.length === 0) return { error: "a group needs at least one agent besides you" }
  if (members.length + made.length > MAX_MEMBERS) return { error: `a group holds ${MAX_MEMBERS} agents besides you` }
  if (new TextEncoder().encode(input.chat).length > MAX_CHAT) return { error: `/chat.md holds ${MAX_CHAT} bytes. tighten it` }
  return { kind: "group", title, members, agents: made, chat: `${input.chat.trim()}\n` }
}

export function introduction(spec: NewAgentSpec): string {
  return `yuki just made you for the human: ${spec.description}. this is your own chat with them. say hi in a line, in your voice, and ask what to start with.`
}
