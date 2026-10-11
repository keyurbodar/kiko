import { type Chat, type Message, newRoomId, type RoomToClient, type UserToClient } from "@yuki/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { until } from "./mid-run"

// Architecture section 7.11, with the real model. The human never fills in a form:
//
//   1. temp      the new chat button's temporary chat with yuki
//   2. agent     yuki makes the agent in the same run: it exists with yuki's soul, its chat opens, and
//                it says hi first
//   3. group     another temporary chat: yuki makes the group, the chat becomes the group with new
//                agents and yuki's /chat.md, and joins the chat list

function messages(room: RoomHandle): Message[] {
  const out = new Map<string, Message>()
  for (const entry of room.raw.log) {
    const f = entry.frame as RoomToClient
    if (entry.dir === "in" && f.t === "events") for (const e of f.events) if (e.t === "message") out.set(e.id, e)
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq)
}
const yuki = (room: RoomHandle, after = 0) => messages(room).filter((m) => m.seq > after && m.from.kind === "agent" && m.from.slug === "yuki")
const last = (room: RoomHandle) => messages(room).at(-1)?.seq ?? 0

const suite: Suite = {
  name: "chief",
  model: true,
  async run(v) {
    const s = await v.as(`chief-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const agents = () => {
      const seen = new Map<string, { slug: string }>()
      for (const entry of user.log) {
        const f = entry.frame as UserToClient
        if (entry.dir !== "in") continue
        if (f.t === "reset") for (const a of f.snapshot.agents ?? []) seen.set(a.id, a)
        if (f.t === "events") for (const e of f.events) if (e.t === "agent") seen.set(e.agent.id, e.agent)
      }
      return [...seen.values()]
    }
    const chats = () => {
      const seen = new Map<string, Chat>()
      for (const entry of user.log) {
        const f = entry.frame as UserToClient
        if (entry.dir === "in" && f.t === "events") for (const e of f.events) if (e.t === "chat") seen.set(e.chat.roomId, e.chat)
      }
      return seen
    }

    // 1. A temporary chat with yuki.
    const draftId = newRoomId()
    let t0 = Date.now()
    user.send({ t: "chat", op: { op: "create", roomId: draftId, title: "new chat", agents: ["yuki"], temp: true } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === draftId))
    const draft = await s.room(draftId)

    // 2. The agent, its chat, its hello.
    let from = last(draft)
    t0 = Date.now()
    draft.send("make me an agent to help me plan my weekly meals and grocery list")
    await until("the made line", () => messages(draft).some((m) => m.seq > from && m.goto), 90_000).catch((e) => {
      throw new VerifyError(`${e instanceof Error ? e.message : e}. yuki said: ${JSON.stringify(yuki(draft, from).map((m) => m.text))}`)
    })
    const made = messages(draft).find((m) => m.seq > from && m.goto)!
    const agent = agents()[0]
    if (!agent) throw new VerifyError("no agent was made")
    console.log(`  made @${agent.slug} (${Date.now() - t0} ms): ${JSON.stringify(made.text)}`)
    const soul = (await (await fetch(new URL(`api/souls/${agent.slug}`, v.url.endsWith("/") ? v.url : `${v.url}/`), { headers: { cookie: s.cookie } })).json()) as { body: string }
    console.log(`  its soul: ${JSON.stringify(soul.body.slice(0, 240))}`)
    if (soul.body.length < 80) throw new VerifyError("the soul yuki wrote is too thin")
    const dm = await s.room(made.goto!)
    await until(`@${agent.slug} says hi`, () => messages(dm).some((m) => m.from.kind === "agent" && m.from.slug === agent.slug), 90_000)
    console.log(`  hello (${Date.now() - t0} ms): ${JSON.stringify(messages(dm).find((m) => m.from.kind === "agent")!.text)}`)

    // 3. A group.
    const groupId = newRoomId()
    t0 = Date.now()
    user.send({ t: "chat", op: { op: "create", roomId: groupId, title: "new chat", agents: ["yuki"], temp: true } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === groupId))
    const group = await s.room(groupId)
    from = last(group)
    group.send(`make a group to plan a weekend in lisbon: @${agent.slug} for food, and a new one who plans the itinerary`)
    await until("the temporary chat to become the group", () => chats().get(groupId) !== undefined && chats().get(groupId)?.temp === undefined, 120_000).catch((e) => {
      throw new VerifyError(`${e instanceof Error ? e.message : e}. yuki said: ${JSON.stringify(yuki(group, from).map((m) => m.text))}`)
    })
    const members = new Set<string>()
    for (const entry of group.raw.log) {
      const f = entry.frame as RoomToClient
      if (entry.dir === "in" && f.t === "events") for (const e of f.events) if (e.t === "member") members.add(e.member.slug)
    }
    const chatMd = [...group.raw.log].some((entry) => {
      const f = entry.frame as RoomToClient
      return entry.dir === "in" && f.t === "events" && f.events.some((e) => e.t === "file" && e.file.name === "chat.md")
    })
    console.log(`  group "${chats().get(groupId)!.title}" (${Date.now() - t0} ms): ${[...members].map((m) => `@${m}`).join(", ")}; /chat.md ${chatMd ? "written" : "missing"}`)
    if (!members.has(agent.slug)) throw new VerifyError(`@${agent.slug} is not in the group`)
    if (members.size < 3) throw new VerifyError("the group has no new agent")
    if (!chatMd) throw new VerifyError("yuki wrote no /chat.md")
    for (const r of [draft, dm, group]) r.raw.close()
  },
}

export default suite
