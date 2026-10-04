import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import type { Agent } from "@kiko/protocol"
import type { ProposalInput } from "../../room/chief"
import { declareEffect } from "../effects"

// Architecture section 7.11. Only kiko, the chief, makes the human's agents and groups. It works
// out what they want, proposes a name and a soul (or a group and its /chat.md), shows it, and
// creates it only after the human answers: the room refuses a create no human message followed.

export const CHIEF_EXT = "chief"

export type ChiefPort = {
  agents(): Promise<Agent[]>
  propose(input: ProposalInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  create(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>
}

const CHIEF_RULES = `you're the chief: you make the human's agents and groups, and only you can. they never fill in a form.
- for something ongoing (a trip, a habit, a project, a craft), a specialist usually beats you doing it all: offer one. a one-off question, just answer.
- an agent: get the goal (one question at most), then propose_agent with a short memorable name, a handle, one line on what it does, and its soul. write the soul as the agent, in first person: who it is, how it talks, how it works for this human, what it won't do. specific beats generic, under 1500 characters, casual and direct like you. end it with "## what i've learned about working with them".
- a group: list_agents first. reuse agents that fit; make new ones only for roles nobody covers. propose_group with a title, the members, the new agents with their souls, and /chat.md: the goal, who does what, empty decisions.
- then show it in two or three lines (name, what it does, its vibe) and ask if you should make it. create only after they say yes. if they change something, propose again.
- after create, one short line.`

const text = (t: string) => [{ type: "text" as const, text: t }]
const fail = (t: string) => ({ content: text(t), isError: true })

const NewAgent = Type.Object({
  name: Type.String({ description: "a short display name, lowercase" }),
  handle: Type.String({ description: "the @handle: lowercase letters, digits, dashes" }),
  description: Type.String({ description: "one line on what it does, for teammates" }),
  soul: Type.String({ description: "its soul.md, in its own first person" }),
})

type Spec = { name: string; handle: string; description: string; soul: string }

export function chiefExtension(port: ChiefPort): Extension {
  const list = defineTool({
    name: "list_agents",
    description: "the human's agents: handle, name, and what each does. use it before proposing a group.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const agents = await port.agents()
      return { content: text(agents.length ? agents.map((a) => `@${a.slug} (${a.name}): ${a.prompt.split("\n")[0]}`).join("\n") : "no agents yet, only you") }
    },
  })

  const proposed = (out: { ok: true; id: string } | { ok: false; error: string }) =>
    out.ok ? { content: text(`proposal ${out.id} saved. show it to the human in two or three lines and ask if you should make it. after their yes, call create.`) } : fail(out.error)

  const proposeAgent = defineTool({
    name: "propose_agent",
    description: "propose a new agent for the human: its name, handle, one line on what it does, and its soul. nothing is made until create, after the human says yes.",
    parameters: NewAgent,
    replay: "safe",
    execute: async (a) => proposed(await port.propose({ kind: "agent", agent: a as Spec })),
  })

  const proposeGroup = defineTool({
    name: "propose_group",
    description: "propose a group: a title, the human's agents to include, new agents to make for it, and its /chat.md. nothing is made until create, after the human says yes.",
    parameters: Type.Object({
      title: Type.String(),
      members: Type.Array(Type.String(), { description: "handles of the human's existing agents to include" }),
      new_agents: Type.Array(NewAgent, { description: "agents to make for this group; empty when the existing ones cover it" }),
      chat_md: Type.String({ description: "/chat.md: the goal, who does what, and an empty decisions section" }),
    }),
    replay: "safe",
    execute: async (g) => proposed(await port.propose({ kind: "group", title: g.title, members: g.members, agents: g.new_agents as Spec[], chat: g.chat_md })),
  })

  const create = defineTool({
    name: "create",
    description: "make what your newest proposal describes, after the human said yes to it. refused until they have answered.",
    parameters: Type.Object({ proposal: Type.Optional(Type.String({ description: "a proposal id; leave it out for the newest" })) }),
    replay: "safe",
    execute: async ({ proposal }) => {
      const out = await port.create((proposal ?? "").trim())
      return out.ok ? { content: text(out.text) } : fail(out.error)
    },
  })

  return defineExtension({
    name: CHIEF_EXT,
    sections: [section("chief", () => CHIEF_RULES)],
    tools: [declareEffect("read", list), declareEffect("write", proposeAgent), declareEffect("write", proposeGroup), declareEffect("write", create)],
  })
}
