import { poll } from "../kit"
import { newRoomId } from "@kiko/protocol"
import type { Agent, AgentSlug, Member, Message, RoomEvent, RoomId, RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send } from "./mid-run"


const TEAM = ["bob", "ada", "cy"] as const
const MEMBERS = ["yuki", ...TEAM] as const
const agentOf = (name: string): Agent => ({
  id: `team-routing-${name}`,
  name,
  slug: name as AgentSlug,
  prompt: name === "bob" ? "plans the work" : "",
  model: "opencode-go/deepseek-v4.1-flash",
})


async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(`api/dev/agent/${path}`, url), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new VerifyError(`the dev agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res.json()
}

type Status = { open: boolean; inbox: { waiting: number; claimed: number; submitted: number }; submissions: number }

const events = (room: RoomHandle): RoomEvent[] =>
  room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? [...(e.frame as Extract<RoomToClient, { t: "events" }>).events] : []))

const members = (room: RoomHandle): Member[] => {
  const list = new Map<string, Member>()
  for (const e of events(room)) {
    if (e.t === "member") list.set(e.member.slug, e.member)
    if (e.t === "member_removed") list.delete(e.slug)
  }
  for (const e of room.raw.log) {
    const f = e.frame as RoomToClient
    if (e.dir === "in" && f.t === "reset") for (const m of f.snapshot.members) list.set(m.slug, m)
  }
  return [...list.values()]
}

const bubbles = (room: RoomHandle): Record<string, string[]> => {
  const out: Record<string, string[]> = Object.fromEntries(MEMBERS.map((s) => [s, []]))
  for (const e of events(room)) {
    if (e.t !== "message" || e.from.kind !== "agent") continue
    const list = out[e.from.slug] ?? []
    out[e.from.slug] = list
    list.push((e as Message).text)
  }
  return out
}

const suite: Suite = {
  name: "team-routing",
  async run(v) {
    const s = await v.as("team-routing")
    const user = await s.user()
    for (const name of TEAM) user.send({ t: "agent", op: { op: "create", agent: agentOf(name) } })
    const roomId = newRoomId() as RoomId
    user.send({ t: "chat", op: { op: "create", roomId, title: "ship the plan", agents: TEAM.map((n) => agentOf(n).id) } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await dev(v.url, s.cookie, "fake", { roomId, slugs: MEMBERS })

    await poll("four members", () => members(room).length === 4, 5_000)
    expectEqual(
      members(room).map((m) => `${m.slug}${m.lead ? " (lead)" : ""}`),
      ["kiko (lead)", "bob", "ada", "cy"],
      "the members seeded from the chat's agents",
    )
    console.log(`  ok members: ${members(room).map((m) => `${m.slug}${m.lead ? " (lead)" : ""}`).join(", ")}`)

    const status = async (slug: string) => (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
    const received = async (slug: string) => {
      const st = await status(slug)
      return st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
    }

    await send(room, "hello team")
    await poll("kiko's answer", () => bubbles(room).kiko?.length === 1, 15_000)
    await Bun.sleep(2_500)
    expectEqual([await received("bob"), await received("ada"), await received("cy")], [0, 0, 0], "envelopes bob, ada and cy received after an untagged message")
    expectEqual(bubbles(room), { kiko: ["heard: hello team"], bob: [], ada: [], cy: [] }, "bubbles after an untagged message")
    console.log("  ok untagged: only kiko, the lead, was woken")

    await send(room, "@bob [reply] noted")
    await poll("bob's answer", () => bubbles(room).bob?.length === 1, 15_000)
    await Bun.sleep(2_500)
    expectEqual([await received("ada"), await received("cy")], [0, 0], "envelopes ada and cy received after @bob")

    await send(room, "@ada [missed] your turn")
    await poll("ada's answer", () => bubbles(room).ada?.length === 1, 15_000)
    await Bun.sleep(2_500)
    const b = bubbles(room)
    expectEqual(b.ada, ["heard: @ada [missed] your turn; missed: human: hello team | @yuki: heard: hello team | human: @bob [reply] noted | @bob: noted"], "ada's answer")
    expectEqual([b.bob?.length, b.cy?.length], [1, 0], "bob's and cy's bubbles after @ada")
    expectEqual(await received("cy"), 0, "envelopes cy received")
    console.log(`  ok @ada: ${JSON.stringify(b.ada?.[0])}`)

    await send(room, "@all ping")
    await poll("four answers", () => MEMBERS.every((n) => bubbles(room)[n]?.includes("heard: @all ping")), 20_000)
    await Bun.sleep(1_500)
    expectEqual(
      bubbles(room),
      {
        kiko: ["heard: hello team", "heard: @all ping"],
        bob: ["noted", "heard: @all ping"],
        ada: ["heard: @ada [missed] your turn; missed: human: hello team | @yuki: heard: hello team | human: @bob [reply] noted | @bob: noted", "heard: @all ping"],
        cy: ["heard: @all ping"],
      },
      "bubbles after @all",
    )
    console.log(`  ok @all: kiko, bob, ada, and cy each answered once`)

    const from = room.raw.log.length
    const runsSince = () => {
      const runs: Record<string, number> = Object.fromEntries(MEMBERS.map((n) => [n, 0]))
      const busy = new Set<string>()
      for (const e of room.raw.log.slice(from)) {
        const f = e.frame as RoomToClient
        if (e.dir !== "in" || f.t !== "status") continue
        if (f.state === "idle") busy.delete(f.slug)
        else if (!busy.has(f.slug)) {
          busy.add(f.slug)
          runs[f.slug] = (runs[f.slug] ?? 0) + 1
        }
      }
      return runs
    }
    const reactsSince = () =>
      room.raw.log.slice(from).flatMap((e) => {
        const f = e.frame as RoomToClient
        return e.dir === "in" && f.t === "events" ? f.events.filter((x) => x.t === "react" && x.by.kind === "agent") : []
      })
    const before = bubbles(room)
    await send(room, "@all [reply] [react:👍]")
    await poll("four reactions", () => reactsSince().length === 4, 20_000)
    await Bun.sleep(5_000)
    expectEqual(runsSince(), { yuki: 1, bob: 1, ada: 1, cy: 1 }, "runs after four agents reacted")
    expectEqual(bubbles(room), before, "bubbles after the reactions")
    expectEqual(reactsSince().length, 4, "agent reactions")
    console.log(`  ok reactions: four agents reacted, one run each, and no reaction started a run`)

    room.raw.send({ t: "hello", lastSeq: 1_000_000 })
    const reset = await room.expect((f) => f.t === "reset", 5_000)
    if (reset.t !== "reset") throw new VerifyError("no reset")
    expectEqual(reset.snapshot.members.map((m) => m.slug), ["yuki", "bob", "ada", "cy"], "members in the snapshot")
    console.log(`  ok snapshot: ${reset.snapshot.members.length} members`)
    room.raw.close()
  },
}

export default suite
