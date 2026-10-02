import type { Agent, AgentSlug, Message, RoomEvent, RoomId, RoomToClient } from "@kiko/protocol"
import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send, ulid, until } from "./mid-run"

// P6-03, architecture sections 7.5 and 7.7. Fake agents (apps/server/src/agent/dev-fake.ts) that
// always answer each other, through the room's `send_message` and `broadcast` tools. No tokens.
// Needs a development server.
//
//   two agents that echo each other forever stop at hop 8, with one system event in the chat
//   five agents that broadcast to each other forever cause at most 40 agent deliveries for one root
//   the agent whose send was refused answers the human with a bubble, which wakes nobody
//   check_agent reads a member row and wakes nobody

const agentOf = (slug: string): Agent => ({ id: `team-loops-${slug}`, name: slug, slug: slug as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })
const base = (url: string) => (url.endsWith("/") ? url : `${url}/`)

async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(`api/dev/agent/${path}`, base(url)), { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) })
  if (!res.ok) throw new VerifyError(`the dev agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res.json()
}

type Status = { inbox: { waiting: number; claimed: number; submitted: number } }

const events = (room: RoomHandle): RoomEvent[] =>
  room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? [...(e.frame as Extract<RoomToClient, { t: "events" }>).events] : []))
const messages = (room: RoomHandle): Message[] => events(room).flatMap((e) => (e.t === "message" ? [e as Message] : []))
/** Messages agents sent with `send_message` or `broadcast`: an agent message that is not a run's bubble. */
const agentSends = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent" && !m.run)
const bubbles = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent" && m.run)
const notices = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "system" && m.from.reason === "run_budget")

async function team(v: { url: string }, s: Session, slugs: string[], title: string) {
  const user = await s.user()
  for (const slug of slugs) user.send({ t: "agent", op: { op: "create", agent: agentOf(slug) } })
  const roomId = ulid() as RoomId
  user.send({ t: "chat", op: { op: "create", roomId, title, agents: slugs.map((n) => agentOf(n).id) } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await dev(v.url, s.cookie, "fake", { roomId, slugs })
  /** Every envelope each agent's inbox ever stored. */
  const received = async () => {
    let total = 0
    for (const slug of slugs) {
      const st = (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
      total += st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
    }
    return total
  }
  return { room, received }
}

/** Waits until nothing new arrives for `quietMs`. */
async function settle(count: () => number, quietMs: number, maxMs: number) {
  const end = Date.now() + maxMs
  let last = -1
  let since = Date.now()
  while (Date.now() < end) {
    const n = count()
    if (n !== last) {
      last = n
      since = Date.now()
    } else if (Date.now() - since > quietMs) return
    await Bun.sleep(200)
  }
  throw new VerifyError("the room never went quiet")
}

const suite: Suite = {
  name: "team-loops",
  async run(v) {
    const s = await v.as("team-loops")

    // 1. Two agents that always echo each other. ana gets the human message and starts the chain.
    {
      const { room, received } = await team(v, s, ["ana", "ben"], "echo forever")
      await send(room, "[send ben] [echo]")
      await until("the loop notice", () => notices(room).length > 0, 60_000)
      await settle(() => messages(room).length, 4_000, 30_000)
      const sends = agentSends(room)
      expectEqual(
        sends.map((m) => `${m.from.kind === "agent" ? m.from.slug : ""}: ${m.text}`),
        Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? "ana: @ben [echo]" : "ben: @ana [echo]")),
        "agent messages, one per hop",
      )
      expectEqual(notices(room).length, 1, "system events")
      const refused = bubbles(room).filter((m) => m.text.includes("summarize what the team has so far for the human"))
      expectEqual(refused.length, 1, "bubbles that answered a refused send")
      // 1 human delivery plus 8 agent deliveries. The refused send and every bubble woke nobody.
      expectEqual(await received(), 9, "envelopes the two inboxes stored")
      console.log(`  ok echo: 8 hops sent, hop 9 refused; notice: ${JSON.stringify(notices(room)[0]!.text)}`)

      // check_agent reads the room and wakes nobody.
      await send(room, "[check ben]")
      await until("ana's check", () => bubbles(room).some((m) => m.text.includes("status:")), 15_000)
      await Bun.sleep(1_500)
      const check = bubbles(room).find((m) => m.text.includes("status:"))!
      if (!check.text.includes("@ben (ben)")) throw new VerifyError(`check_agent answered ${JSON.stringify(check.text)}`)
      expectEqual(await received(), 10, "envelopes after check_agent (only the human's)")
      console.log("  ok check_agent: read ben's row, woke nobody")
      room.raw.close()
    }

    // 2. Five agents that broadcast to each other forever. An agent answers a batch once, so with fewer
    // agents the hop limit trips first. Each broadcast is 4 deliveries, and one root may cause at most 40.
    {
      const { room, received } = await team(v, s, ["cat", "dov", "eli", "fay", "gus"], "shout forever")
      await send(room, "[shout]")
      await until("the loop notice", () => notices(room).length > 0, 90_000)
      await settle(() => messages(room).length, 5_000, 60_000)
      const deliveries = agentSends(room).length * 4
      const stored = (await received()) - 1
      if (stored > 40 || deliveries > 40) throw new VerifyError(`${stored} agent deliveries stored, ${deliveries} sent: more than 40`)
      expectEqual(stored, 40, "agent deliveries the inboxes stored")
      expectEqual(notices(room).map((m) => m.text.includes("40 messages")), [true], "one system event, for the root limit")
      console.log(`  ok broadcast: ${agentSends(room).length} broadcasts, ${stored} agent deliveries, then: ${JSON.stringify(notices(room)[0]!.text)}`)
      room.raw.close()
    }
  },
}

export default suite
