import type { Agent, AgentSlug, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { expectEqual } from "../client"
import type { Suite } from "../runner"

// A user's agent list. One device creates an agent and a second device sees it live.
// A chat made with agent ids keeps them. A repeat of the same agent changes nothing.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  const random = crypto.getRandomValues(new Uint8Array(16))
  return head + Array.from(random, (b) => CROCKFORD[b % 32]).join("")
}

const agentEvents = (frame: UserToClient, id: string): Extract<UserEvent, { t: "agent" }>[] =>
  frame.t === "events" ? frame.events.filter((e): e is Extract<UserEvent, { t: "agent" }> => e.t === "agent" && e.agent.id === id) : []

const suite: Suite = {
  name: "agents",
  async run(v) {
    const s = await v.as("agents")
    const a = await s.user()
    const b = await s.user()
    await a.expect(() => true)
    await b.expect(() => true)

    const id = crypto.randomUUID()
    const agent: Agent = { id, name: "ada", slug: `ada-${id.slice(0, 8)}` as AgentSlug, prompt: "reads code", model: "opencode-go/deepseek-v4.1-flash" }
    a.send({ t: "agent", op: { op: "create", agent } })
    a.send({ t: "agent", op: { op: "create", agent } }) // a resend changes nothing
    const seen = agentEvents(await b.expect((f) => agentEvents(f, id).length > 0), id)
    expectEqual(seen.map((e) => e.agent), [agent], "agent on the second device")
    await b.expectNone((f) => agentEvents(f, id).length > 0, 400)

    const roomId = ulid() as RoomId
    a.send({ t: "chat", op: { op: "create", roomId, title: "ada", agents: [id] } })
    const made = await b.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const chat = made.t === "events" ? made.events.flatMap((e) => (e.t === "chat" && e.chat.roomId === roomId ? [e.chat] : []))[0] : undefined
    expectEqual(chat?.agents, [id], "agent ids stored on the chat")

    a.send({ t: "chat", op: { op: "delete", roomId } })
    await b.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat_removed" && e.roomId === roomId))
  },
}

export default suite
