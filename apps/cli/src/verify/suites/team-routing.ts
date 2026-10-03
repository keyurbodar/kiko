import type { Agent, AgentSlug, Member, Message, RoomEvent, RoomId, RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send, ulid, until } from "./mid-run"

// P6-01, architecture sections 7.2 and 7.4. A chat made from the new-chat screen with three of
// the user's agents: bob, ada, and cy. A group is seeded with kiko first, as its chief and lead
// (section 7.11), so the room has four members. Each is the scripted fake
// agent of `apps/server/src/agent/dev-fake.ts`, so the suite is deterministic and spends no
// tokens. The fake answers `heard: <the turns it got>`, and with `[missed]` in the text it adds
// `; missed: <the missed messages of the room's brief>`. Needs a development server.
//
//   an untagged message reaches the lead, and the others only after the lead's run ends, as a
//   follow-up they may answer or [skip] (the fake skips)
//   @ada reaches only ada, and her delivery carries the messages she missed
//   @all reaches everyone
//   an agent that was not addressed ran no model call (its inbox never received anything)

const TEAM = ["bob", "ada", "cy"] as const
/** The room's members: kiko leads every group, then the agents the chat was made with. */
const MEMBERS = ["kiko", ...TEAM] as const
const agentOf = (name: string): Agent => ({
  id: `team-routing-${name}`,
  name,
  slug: name as AgentSlug,
  prompt: name === "bob" ? "plans the work" : "",
  model: "opencode-go/deepseek-v4.1-flash",
})

const base = (url: string) => (url.endsWith("/") ? url : `${url}/`)

async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(`api/dev/agent/${path}`, base(url)), {
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

/** Each agent's bubbles, oldest first. */
const bubbles = (room: RoomHandle): Record<string, string[]> => {
  const out: Record<string, string[]> = Object.fromEntries(MEMBERS.map((s) => [s, []]))
  for (const e of events(room)) if (e.t === "message" && e.from.kind === "agent") (out[e.from.slug] ??= []).push((e as Message).text)
  return out
}

const suite: Suite = {
  name: "team-routing",
  async run(v) {
    const s = await v.as("team-routing")
    const user = await s.user()
    // A repeat of the same agent id changes nothing, so a second run of the suite reuses them.
    for (const name of TEAM) user.send({ t: "agent", op: { op: "create", agent: agentOf(name) } })
    const roomId = ulid() as RoomId
    user.send({ t: "chat", op: { op: "create", roomId, title: "ship the plan", agents: TEAM.map((n) => agentOf(n).id) } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await dev(v.url, s.cookie, "fake", { roomId, slugs: MEMBERS })

    await until("four members", () => members(room).length === 4, 5_000)
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

    // 1. Untagged: the lead first, then the others as a follow-up, which the fake skips.
    await send(room, "hello team")
    await until("kiko's answer", () => bubbles(room).kiko!.length === 1, 15_000)
    const followed = async () => (await received("bob")) === 1 && (await received("ada")) === 1 && (await received("cy")) === 1
    const end = Date.now() + 15_000
    while (!(await followed())) {
      if (Date.now() > end) throw new VerifyError(`bob, ada and cy did not each get the follow-up: ${await received("bob")}, ${await received("ada")}, ${await received("cy")}`)
      await Bun.sleep(200)
    }
    await Bun.sleep(2_500)
    expectEqual(bubbles(room), { kiko: ["heard: hello team"], bob: [], ada: [], cy: [] }, "bubbles after an untagged message")
    console.log("  ok untagged: kiko answered first; bob, ada and cy got it after and stayed quiet")

    // 2. @bob reaches only bob, so ada and cy miss it.
    await send(room, "@bob [reply] noted")
    await until("bob's answer", () => bubbles(room).bob!.length === 1, 15_000)
    await Bun.sleep(2_500)
    expectEqual([await received("ada"), await received("cy")], [1, 1], "envelopes ada and cy received after @bob")

    // @ada: only ada, and her brief carries what she missed.
    await send(room, "@ada [missed] your turn")
    await until("ada's answer", () => bubbles(room).ada!.length === 1, 15_000)
    await Bun.sleep(2_500)
    const b = bubbles(room)
    expectEqual(b.ada, ["heard: @ada [missed] your turn; missed: human: @bob [reply] noted | @bob: noted"], "ada's answer")
    expectEqual([b.bob!.length, b.cy!.length], [1, 0], "bob's and cy's bubbles after @ada")
    expectEqual(await received("cy"), 1, "envelopes cy received")
    console.log(`  ok @ada: ${JSON.stringify(b.ada![0])}`)

    // 3. @all: everyone.
    await send(room, "@all ping")
    await until("four answers", () => MEMBERS.every((n) => bubbles(room)[n]!.includes("heard: @all ping")), 20_000)
    await Bun.sleep(1_500)
    expectEqual(
      bubbles(room),
      {
        kiko: ["heard: hello team", "heard: @all ping"],
        bob: ["noted", "heard: @all ping"],
        ada: ["heard: @ada [missed] your turn; missed: human: @bob [reply] noted | @bob: noted", "heard: @all ping"],
        cy: ["heard: @all ping"],
      },
      "bubbles after @all",
    )
    console.log(`  ok @all: kiko, bob, ada, and cy each answered once`)

    // 4. P6-07: agents that react to every message start no runs. All three answer one human
    // message with only a reaction tag. The human message starts one run each; the three stored
    // reactions start none, for longer than a burst.
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
    await until("four reactions", () => reactsSince().length === 4, 20_000)
    await Bun.sleep(5_000)
    expectEqual(runsSince(), { kiko: 1, bob: 1, ada: 1, cy: 1 }, "runs after four agents reacted")
    expectEqual(bubbles(room), before, "bubbles after the reactions")
    expectEqual(reactsSince().length, 4, "agent reactions")
    console.log(`  ok reactions: four agents reacted, one run each, and no reaction started a run`)

    // 5. The room stores each member's latest status, and a reset snapshot carries the members.
    room.raw.send({ t: "hello", lastSeq: 1_000_000 })
    const reset = await room.expect((f) => f.t === "reset", 5_000)
    if (reset.t !== "reset") throw new VerifyError("no reset")
    expectEqual(reset.snapshot.members.map((m) => m.slug), ["kiko", "bob", "ada", "cy"], "members in the snapshot")
    console.log(`  ok snapshot: ${reset.snapshot.members.length} members`)
    room.raw.close()
  },
}

export default suite
