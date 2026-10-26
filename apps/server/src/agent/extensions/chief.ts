import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section, wrapSection } from "@earendil-works/pi-durable"
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

const CHIEF_RULES = `You are the chief: you make the human's agents. This chat is only ever you and them and never gets members, even when asked; to bring an agent into a conversation with you, create_group with kiko and that agent.
- For something ongoing (a trip, a habit, a project), offer a specialist. For a one-off question, just answer.
- A new agent: get the goal (one question at most), then create_agent with a short memorable name. Write its soul as the agent, in the first person: who it is, how it talks, how it works for this human, what it will not do. Specific, under 1500 characters, casual and direct. End it with "## what i've learned about working with them".
- A quick one-off for an agent the human has: send_message it privately. A team effort: reuse agents that fit, make new ones only for roles nobody covers, and create_group, with its tasks when the work is tracked. From then on the group is the work's only home: you drive it there, and the human reads the result there. Do not message its members from this chat.
- After you make something, show it in two or three lines (name, what it does, its vibe). To change it, ask the human what, then make it again.`

const MEMBER_RULES = `For a job that needs several agents together, create_group. For a quick one-off with another agent, send_message them privately. Only Kiko makes new agents; ask Kiko when none fits.`

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
      return {
        output: text(
          agents.length
            ? agents.map((a) => `@${a.slug} (${a.name}): ${a.prompt.split("\n")[0]}`).join("\n")
            : "no agents yet, only kiko",
        ),
      }
    },
  })

  const createAgent = defineTool({
    name: "create_agent",
    description:
      "make a new agent for the human: its name, handle, one line on what it does, and its soul. it gets its own chat and says hi. only kiko can.",
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
      "start a new group chat for a team effort. kiko is always in it, and you are too. members are the human's existing agents by handle. goal becomes /chat.md with who does what. kickoff is your first message to everyone in the group: it is posted as yours and delivered at once, so they start without the human. a teammate acts only on a message or task that reaches it, and never on another teammate's reply, so the kickoff asks only for work each can start now; you send each later step yourself when the answers come back, together. tasks go on the group's board, which only exists in the group. asking again for the same agents reuses the chat and sends the kickoff there. only kiko may pass new_agents.",
    parameters: Type.Object({
      title: Type.String(),
      members: Type.Array(Type.String(), { description: "handles of the human's existing agents to include" }),
      goal: Type.String({ description: "what the group is for, in a few lines" }),
      kickoff: Type.String({
        description: "your first message to everyone in the group: the task and what you need from each",
      }),
      new_agents: Type.Optional(
        Type.Array(NewAgent, { description: "kiko only: agents to make for this group, with souls" }),
      ),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            title: Type.String({ description: "an action label of fewer than 12 words" }),
            owner: Type.String({ description: "the member's handle" }),
            after: Type.Optional(
              Type.Array(Type.Integer(), {
                description: "numbers, from 1, of earlier tasks in this list that must be done first",
              }),
            ),
          }),
          {
            maxItems: 12,
            description:
              "only when the human asks for tracked tasks: the group's starting board. leave it out for a single round of steps, which you drive with messages",
          },
        ),
      ),
    }),
    replay: "safe",
    execute: async (g) => {
      const out = await port.createGroup({
        title: g.title,
        members: g.members,
        goal: g.goal,
        kickoff: g.kickoff,
        newAgents: (g.new_agents ?? []) as NewAgentSpec[],
        ...(g.tasks?.length ? { tasks: g.tasks } : {}),
      })
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })

  const deleteGroup = defineTool({
    name: "delete_group",
    description: "delete a group chat and its files, routines, and memory. only kiko can, on the human's request.",
    parameters: Type.Object({ room_id: Type.String() }),
    replay: "safe",
    execute: async (a) => {
      const out = await port.deleteGroup(a.room_id)
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })
  const deleteAgent = defineTool({
    name: "delete_agent",
    description:
      "delete an agent and its private chats, files, routines, and memory, and remove it from groups. only kiko can, on the human's request. kiko cannot be deleted.",
    parameters: Type.Object({ handle: Type.String() }),
    replay: "safe",
    execute: async (a) => {
      const out = await port.deleteAgent(a.handle)
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })
  const removeMember = defineTool({
    name: "remove_member",
    description:
      "remove an agent from this group using the human's membership rules. Kiko can pass room_id from overview to manage another group. Kiko cannot be removed.",
    parameters: Type.Object({ handle: Type.String(), room_id: Type.Optional(Type.String()) }),
    replay: "safe",
    execute: async (a) => {
      const out = await port.removeMember(a.handle, a.room_id)
      return out.ok ? { output: text(out.text) } : fail(out.error)
    },
  })

  const overview = defineTool({
    name: "overview",
    description:
      "what is open across all of the human's chats: recent chats and unread, open tasks and how stale, routines (reminders are one-time routines) and their last runs.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => ({ output: text(await port.overview()) }),
  })

  return defineExtension({
    name: GROUPS_EXT,
    sections: [section("groups", () => (port.chief ? CHIEF_RULES : MEMBER_RULES))],
    wraps: port.chief ? [wrapSection("team", (team) => ({ ...team, render: () => undefined }))] : [],
    tools: port.chief
      ? [
          declareEffect("read", list),
          declareEffect("write", createAgent),
          declareEffect("message", createGroup),
          declareEffect("read", overview),
          declareEffect("write", deleteGroup),
          declareEffect("write", deleteAgent),
          declareEffect("write", removeMember),
        ]
      : [declareEffect("read", list), declareEffect("message", createGroup), declareEffect("write", removeMember)],
  })
}
