import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import type { Agent } from "@kiko/protocol"
import type { GroupInput, NewAgentSpec } from "../../room/chief"
import { declareEffect } from "@kiko/agent/effects"

export const GROUPS_EXT = "groups"

type Made = { ok: true; text: string } | { ok: false; error: string }

export type GroupsPort = {
  chief: boolean
  agents(): Promise<Agent[]>
  createAgent(spec: NewAgentSpec): Promise<Made>
  createGroup(input: GroupInput): Promise<Made>
  deleteGroup(roomId: string): Promise<Made>
  deleteAgent(handle: string): Promise<Made>
  removeMember(handle: string, roomId?: string): Promise<Made>
  overview(): Promise<string>
}

const CHIEF_RULES = `You are the chief. You make the human's agents, and this chat is only ever you and them.
- For something ongoing (a trip, a habit, a project, a craft), a specialist usually beats you doing it all: offer one. For a one-off question, just answer.
- An agent: get the goal (one question at most), then create_agent with a short memorable name, a handle, one line on what it does, and its soul. Write the soul as the agent, in the first person: who it is, how it talks, how it works for this human, what it will not do. Specific beats generic, under 1500 characters, casual and direct like you. End it with "## what i've learned about working with them".
- A quick one-off for an agent the human already has goes to it privately: send_message. No group.
- A team effort goes in a new group: list_agents first, reuse agents that fit, make new ones only for roles nobody covers. Call create_group with a title, the members, the goal, the new agents with their souls, and a kickoff. The kickoff is your first message to everyone in it, so they start at once. You stay in the group; when they answer, drive the rounds yourself and tell the human the result.
- This chat never gets members, not even when asked. To bring an agent into a conversation with you, create_group with kiko and that agent.
- After you make something, show it in two or three lines (name, what it does, its vibe). To change it, ask the human what, then make it again.`

const MEMBER_RULES = `You can start a group with create_group when a job needs several agents working together: list_agents to see who the human has, then a title, the members, the goal, and a kickoff, your first message to everyone in it. Kiko is in every group. For a quick one-off with another agent, send_message them privately instead. Only Kiko makes new agents; ask Kiko when none fits.`

const text = (t: string) => [{ type: "text" as const, text: t }]
const fail = (t: string) => ({ output: text(t), isError: true })

const NewAgent = Type.Object({
  name: Type.String({ description: "a short display name, capitalized like a name (Scout)" }),
  handle: Type.String({ description: "the @handle: lowercase letters, digits, dashes" }),
  description: Type.String({ description: "one line on what it does, for teammates" }),
  soul: Type.String({ description: "its soul.md, in its own first person" }),
})

export function groupsExtension(port: GroupsPort): Extension {
  const list = defineTool({
    name: "list_agents",
    description: "the human's agents: handle, name, and what each does. use it before you make a group.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const agents = await port.agents()
      return { output: text(agents.length ? agents.map((a) => `@${a.slug} (${a.name}): ${a.prompt.split("\n")[0]}`).join("\n") : "no agents yet, only kiko") }
    },
  })

  const createAgent = defineTool({
    name: "create_agent",
    description: "make a new agent for the human: its name, handle, one line on what it does, and its soul. it gets its own chat and says hi. only kiko can.",
    parameters: NewAgent,
    replay: "safe",
    execute: async (a) => {
      const out = await port.createAgent(a as NewAgentSpec)
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })

  const createGroup = defineTool({
    name: "create_group",
    description:
      "start a new group chat for a team effort. kiko is always in it, and you are too. members are the human's existing agents by handle. goal becomes /chat.md with who does what. kickoff is your first message to everyone in the group: it is posted as yours and delivered at once, so they start without the human. asking again for the same agents reuses the chat and sends the kickoff there. only kiko may pass new_agents.",
    parameters: Type.Object({
      title: Type.String(),
      members: Type.Array(Type.String(), { description: "handles of the human's existing agents to include" }),
      goal: Type.String({ description: "what the group is for, in a few lines" }),
      kickoff: Type.String({ description: "your first message to everyone in the group: the task and what you need from each" }),
      new_agents: Type.Optional(Type.Array(NewAgent, { description: "kiko only: agents to make for this group, with souls" })),
    }),
    replay: "safe",
    execute: async (g) => {
      const out = await port.createGroup({ title: g.title, members: g.members, goal: g.goal, kickoff: g.kickoff, newAgents: (g.new_agents ?? []) as NewAgentSpec[] })
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })

  const deleteGroup = defineTool({
    name: "delete_group", description: "delete a group chat and its files, routines, and memory. only kiko can, on the human's request.",
    parameters: Type.Object({ room_id: Type.String() }), replay: "safe",
    execute: async (a) => { const out = await port.deleteGroup(a.room_id); return out.ok ? { output: text(out.text) } : fail(out.error) },
  })
  const deleteAgent = defineTool({
    name: "delete_agent", description: "delete an agent and its private chats, files, routines, and memory, and remove it from groups. only kiko can, on the human's request. kiko cannot be deleted.",
    parameters: Type.Object({ handle: Type.String() }), replay: "safe",
    execute: async (a) => { const out = await port.deleteAgent(a.handle); return out.ok ? { output: text(out.text) } : fail(out.error) },
  })
  const removeMember = defineTool({
    name: "remove_member", description: "remove an agent from this group using the human's membership rules. Kiko can pass room_id from overview to manage another group. Kiko cannot be removed.",
    parameters: Type.Object({ handle: Type.String(), room_id: Type.Optional(Type.String()) }), replay: "safe",
    execute: async (a) => { const out = await port.removeMember(a.handle, a.room_id); return out.ok ? { output: text(out.text) } : fail(out.error) },
  })

  const overview = defineTool({
    name: "overview",
    description: "what is open across all of the human's chats: recent chats and unread, open tasks and how stale, routines (reminders are one-time routines) and their last runs.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => ({ output: text(await port.overview()) }),
  })

  return defineExtension({
    name: GROUPS_EXT,
    sections: [section("groups", () => (port.chief ? CHIEF_RULES : MEMBER_RULES))],
    tools: port.chief
      ? [declareEffect("read", list), declareEffect("write", createAgent), declareEffect("message", createGroup), declareEffect("read", overview), declareEffect("write", deleteGroup), declareEffect("write", deleteAgent), declareEffect("write", removeMember)]
      : [declareEffect("read", list), declareEffect("message", createGroup), declareEffect("write", removeMember)],
  })
}
