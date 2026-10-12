import { messages, poll } from "../kit"
import { newRoomId } from "@yuki/protocol"
import type { Agent, AgentSlug, RoomId, } from "@yuki/protocol"
import type { RoomHandle, Session } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send } from "./mid-run"


const agentOf = (slug: string): Agent => ({ id: `team-loops-${slug}`, name: slug, slug: slug as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })

export async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(`api/dev/agent/${path}`, url), { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) })
  if (!res.ok) throw new VerifyError(`the dev agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res.json()
}

type Status = { inbox: { waiting: number; claimed: number; submitted: number } }

export const agentSends = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent" && !m.run)
export const bubbles = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent" && m.run)
export const notices = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "system" && m.from.reason === "run_budget")

export async function team(v: { url: string }, s: Session, slugs: string[], title: string) {
  const user = await s.user()
  for (const slug of slugs) user.send({ t: "agent", op: { op: "create", agent: agentOf(slug) } })
  const roomId = newRoomId() as RoomId
  user.send({ t: "chat", op: { op: "create", roomId, title, agents: slugs.map((n) => agentOf(n).id) } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  const members = slugs.length > 1 ? ["yuki", ...slugs] : slugs
  await dev(v.url, s.cookie, "fake", { roomId, slugs: members })
  const received = async () => {
    let total = 0
    for (const slug of members) {
      const st = (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
      total += st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
    }
    return total
  }
  return { room, received, roomId, members }
}

export async function settle(count: () => number, quietMs: number, maxMs: number) {
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

    {
      const { room, received } = await team(v, s, ["ana", "ben"], "echo forever")
      await send(room, "@ana [send ben] [echo]")
      await poll("the loop notice", () => notices(room).length > 0, 60_000)
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
      expectEqual(await received(), 9, "envelopes the two inboxes stored")
      console.log(`  ok echo: 8 hops sent, hop 9 refused; notice: ${JSON.stringify(notices(room)[0]?.text)}`)

      await send(room, "@ana [team]")
      await poll("ana's look at the team", () => bubbles(room).some((m) => m.text.startsWith("heard: @ana [team]") && m.text.includes("@ben:")), 15_000)
      await Bun.sleep(1_500)
      expectEqual(await received(), 10, "envelopes after team (only the human's)")
      console.log("  ok team: read what ben is doing, woke nobody")
      room.raw.close()
    }

    {
      const { room, received, members } = await team(v, s, ["cat", "dov", "eli", "fay", "gus"], "shout forever")
      await send(room, "@cat [shout]")
      await poll("the loop notice", () => notices(room).length > 0, 90_000)
      await settle(() => messages(room).length, 5_000, 60_000)
      const deliveries = agentSends(room).length * (members.length - 1)
      const stored = (await received()) - 1
      if (stored > 40 || deliveries > 40) throw new VerifyError(`${stored} agent deliveries stored, ${deliveries} sent: more than 40`)
      expectEqual(stored, 40, "agent deliveries the inboxes stored")
      expectEqual(notices(room).map((m) => m.text.includes("40 messages")), [true], "one system event, for the root limit")
      console.log(`  ok broadcast: ${agentSends(room).length} broadcasts, ${stored} agent deliveries, then: ${JSON.stringify(notices(room)[0]?.text)}`)
      room.raw.close()
    }
  },
}

export default suite
