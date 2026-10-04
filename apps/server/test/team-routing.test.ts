import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import type { Agent, AgentSlug, Chat, Member, RoomEvent, RoomId, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import type { Received } from "./fake-agent"

// P6-01. The real RoomDO with recording fake agents (test/fake-agent.ts). Architecture sections
// 7.2 and 7.4: who is woken by a human message, and what the brief tells them.

setDefaultTimeout(30_000)
let mf: Miniflare
let origin: string

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./fake-agent.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      ROOM: { className: "RoomDO", useSQLite: true },
      AGENT: { className: "FakeAgent", useSQLite: true },
      USER: { className: "FakeUser", useSQLite: true },
    },
    r2Buckets: ["FILES"],
  })
  origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6N${String(++n).padStart(16, "0")}` as RoomId
const slug = (s: string) => s as AgentSlug
const agent = (name: string, prompt = ""): Agent => ({ id: `id-${name}`, name, slug: slug(name), prompt, model: "faux/faux-1" })
const chatFor = (roomId: RoomId, title: string, agents?: string[]): Chat => ({
  roomId,
  title,
  pinned: false,
  muted: false,
  lastSeq: 0,
  lastPreview: "",
  unread: 0,
  updatedAt: 0,
  ...(agents ? { agents } : {}),
})
const AGENTS = [agent("bob", "plans"), agent("ada", "reads code"), agent("cy")]

const call = async (path: string, body?: unknown) => {
  const res = await fetch(`${origin}${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })
  return res.json()
}
const received = async (room: RoomId, who: string) => ((await call(`/calls/${room}/${who}`)) as { received: Received[]; stops: number })

class Socket {
  frames: RoomToClient[] = []
  private constructor(readonly ws: WebSocket) {
    ws.onmessage = (e) => this.frames.push(JSON.parse(String(e.data)))
  }
  static async open(room: RoomId): Promise<Socket> {
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    const s = new Socket(ws)
    s.send({ t: "hello", lastSeq: 0 })
    await s.until((f) => f.t === "events" || f.t === "reset")
    return s
  }
  send(frame: unknown) {
    this.ws.send(JSON.stringify(frame))
  }
  async until(match: (f: RoomToClient) => boolean, ms = 3000): Promise<RoomToClient> {
    const end = Date.now() + ms
    for (;;) {
      const hit = this.frames.find(match)
      if (hit) return hit
      if (Date.now() > end) throw new Error(`no frame. have ${JSON.stringify(this.frames)}`)
      await Bun.sleep(20)
    }
  }
  events(): RoomEvent[] {
    return this.frames.flatMap((f) => (f.t === "events" ? f.events : []))
  }
  members(): Member[] {
    const list = new Map<string, Member>()
    for (const e of this.events()) {
      if (e.t === "member") list.set(e.member.slug, e.member)
      if (e.t === "member_removed") list.delete(e.slug)
    }
    return [...list.values()]
  }
  async say(text: string, replyTo?: string): Promise<string> {
    const clientId = crypto.randomUUID()
    this.send({ t: "send", clientId, text, ...(replyTo ? { replyTo } : {}) })
    const ack = await this.until((f) => f.t === "ack" && f.clientId === clientId)
    return ack.t === "ack" ? ack.id : ""
  }
}

/** A room whose chat was created with bob, ada, and cy. kiko is seeded first and leads. */
async function team(): Promise<{ room: RoomId; ws: Socket }> {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "ship the plan", AGENTS.map((a) => a.id))], agents: AGENTS })
  return { room, ws: await Socket.open(room) }
}

/** Waits past the burst debounce until `who` has `count` deliveries. */
async function delivered(room: RoomId, who: string, count: number): Promise<Received[]> {
  const end = Date.now() + 6000
  for (;;) {
    const got = (await received(room, who)).received
    if (got.length >= count) return got
    if (Date.now() > end) throw new Error(`${who} has ${got.length} deliveries, wanted ${count}`)
    await Bun.sleep(100)
  }
}

const counts = async (room: RoomId) =>
  Object.fromEntries(await Promise.all(["kiko", "bob", "ada", "cy"].map(async (s) => [s, (await received(room, s)).received.length])))

test("a chat created with agents seeds kiko as the lead, then them", async () => {
  const { ws } = await team()
  await ws.until(() => ws.members().length === 4)
  expect(ws.members().map((m) => [m.slug, m.lead, m.role ?? null])).toEqual([
    ["kiko", true, null],
    ["bob", false, "plans"],
    ["ada", false, "reads code"],
    ["cy", false, null],
  ])
  ws.ws.close()
})

test("a chat with one agent stays one-to-one: that agent alone, as its lead", async () => {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "solo agent", [AGENTS[0]!.id])], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until(() => ws.members().length === 1)
  await Bun.sleep(200)
  expect(ws.members().map((m) => [m.slug, m.lead])).toEqual([["bob", true]])
  ws.ws.close()
})

test("a chat created without agents gets kiko as its lead", async () => {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "solo")], agents: [] })
  const ws = await Socket.open(room)
  await ws.until(() => ws.members().length === 1)
  expect(ws.members()).toEqual([{ slug: slug("kiko"), name: "kiko", lead: true }])
  ws.ws.close()
})

test("a group with the built-in agent seeds kiko too: the client names it by its slug, and no stored agent has that id", async () => {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "with kiko", ["kiko", AGENTS[1]!.id])], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until(() => ws.members().length === 2)
  expect(ws.members().map((m) => [m.slug, m.lead])).toEqual([
    ["kiko", true],
    ["ada", false],
  ])
  ws.ws.close()
})

test("an untagged burst reaches the others after the lead's run ends, with a note to add or skip", async () => {
  const { room, ws } = await team()
  await ws.say("anyone around?")
  await delivered(room, "kiko", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ kiko: 1, bob: 0, ada: 0, cy: 0 })
  await call(`/end/${room}/kiko/kiko:r1`)
  const [toAda] = await delivered(room, "ada", 1)
  await delivered(room, "bob", 1)
  await delivered(room, "cy", 1)
  expect(toAda!.envelopes.map((e) => e.body)).toEqual(["anyone around?"])
  expect(toAda!.brief).toContain("already answered this")
  // A second end of the same run delivers nothing more.
  await call(`/end/${room}/kiko/kiko:r1`)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ kiko: 1, bob: 1, ada: 1, cy: 1 })
  ws.ws.close()
})

const memory = async (room: RoomId, seqs: number[]) => ((await call(`/memory/${room}`, seqs)) as { view: string }).view

test("untagged reaches only the lead, @ada only ada, @all everyone, and every memory view carries the whole chat", async () => {
  const { room, ws } = await team()
  await ws.say("hello team")
  await delivered(room, "kiko", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ kiko: 1, bob: 0, ada: 0, cy: 0 })
  const first = (await received(room, "kiko")).received[0]!
  expect(first.envelopes.map((e) => e.body)).toEqual(["hello team"])
  expect(first.home).toMatchObject({ slug: "kiko", lead: true })

  await ws.say("@ada your turn")
  const [toAda] = await delivered(room, "ada", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ kiko: 1, bob: 0, ada: 1, cy: 0 })
  expect(toAda!.envelopes.map((e) => e.body)).toEqual(["@ada your turn"])
  expect(toAda!.home).toMatchObject({ slug: "ada", lead: false })
  // She was not sent "hello team", yet her run's <memory> view holds it. Her own envelope is not repeated there.
  const hers = await memory(room, toAda!.envelopes.map((e) => e.seq))
  expect(hers).toContain("human: [")
  expect(hers).toContain("hello team")
  expect(hers).not.toContain("your turn")
  expect(toAda!.brief).not.toContain("hello team")
  expect(toAda!.brief).toContain("room goal: ship the plan")
  expect(toAda!.brief).toContain("- @kiko (kiko): lead")
  expect(toAda!.brief).toContain("- @bob (bob): plans, idle")

  await ws.say("@all ping")
  await delivered(room, "cy", 1)
  await delivered(room, "kiko", 2)
  await delivered(room, "bob", 1)
  await delivered(room, "ada", 2)
  expect(await counts(room)).toEqual({ kiko: 2, bob: 1, ada: 2, cy: 1 })
  const cy = (await received(room, "cy")).received[0]!
  // cy joins the conversation late and still reads every turn before its burst.
  const cys = await memory(room, cy.envelopes.map((e) => e.seq))
  expect(cys).toContain("hello team")
  expect(cys).toContain("@ada your turn")
  expect(cys).not.toContain("ping")
  ws.ws.close()
})

test("a burst sends each agent only its own messages, in one delivery", async () => {
  const { room, ws } = await team()
  await ws.say("@ada one")
  await ws.say("@cy two")
  await ws.say("@ada three")
  await delivered(room, "ada", 1)
  await delivered(room, "cy", 1)
  await Bun.sleep(300)
  const [ada] = (await received(room, "ada")).received
  const [cy] = (await received(room, "cy")).received
  expect(ada!.envelopes.map((e) => e.body)).toEqual(["@ada one", "@ada three"])
  expect(cy!.envelopes.map((e) => e.body)).toEqual(["@cy two"])
  // A message of the same burst addressed to someone else is in her <memory> view, not lost.
  expect(await memory(room, ada!.envelopes.map((e) => e.seq))).toContain("@cy two")
  expect((await counts(room)).bob).toBe(0)
  ws.ws.close()
})

test("a reply to an agent's bubble reaches that agent", async () => {
  const { room, ws } = await team()
  await call(`/post/${room}/cy`)
  const frame = await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "agent"))
  const bubble = frame.t === "events" ? frame.events.find((e) => e.t === "message") : undefined
  await ws.say("yes please", bubble?.t === "message" ? bubble.id : undefined)
  await delivered(room, "cy", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ kiko: 0, bob: 0, ada: 0, cy: 1 })
  ws.ws.close()
})

test("add, rename, and remove members, with the limit of 8, and kiko always stays", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  for (const s of ["d1", "d2", "d3", "d4"]) ws.send({ t: "member", op: { op: "add", slug: s, name: s } })
  await ws.until(() => ws.members().length === 8)
  ws.send({ t: "member", op: { op: "add", slug: "d5", name: "d5" } })
  const refused = await ws.until((f) => f.t === "member_refused")
  expect(refused).toEqual({ t: "member_refused", op: { op: "add", slug: slug("d5"), name: "d5" }, reason: "limit" })
  ws.send({ t: "member", op: { op: "add", slug: "all", name: "all" } })
  await ws.until((f) => f.t === "member_refused" && f.reason === "reserved")

  ws.send({ t: "member", op: { op: "rename", slug: "ada", name: "ada lovelace" } })
  await ws.until(() => ws.members().find((m) => m.slug === "ada")?.name === "ada lovelace")

  // kiko is the chief: it cannot be removed, and it stays the lead.
  ws.send({ t: "member", op: { op: "remove", slug: "kiko" } })
  await ws.until((f) => f.t === "member_refused" && f.reason === "chief")
  expect(ws.members().filter((m) => m.lead).map((m) => m.slug)).toEqual([slug("kiko")])

  ws.send({ t: "member", op: { op: "remove", slug: "bob" } })
  await ws.until(() => !ws.members().some((m) => m.slug === "bob"))
  expect((await received(room, "bob")).stops).toBe(1)

  // A tag for a removed member counts as no tag, so it reaches the lead.
  await ws.say("@bob are you there")
  await delivered(room, "kiko", 1)
  await Bun.sleep(300)
  expect((await received(room, "bob")).received.length).toBe(0)

  // A member that was ever in the room stays in the inventory, so account deletion reaches it.
  const inventory = (await call(`/inventory/${room}`)) as { agents: string[] }
  expect(inventory.agents).toContain("bob")
  expect(inventory.agents.length).toBe(8)

  // A reconnecting client gets the members in a reset snapshot.
  const late = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
  const snapshot = await new Promise<RoomToClient>((resolve) => {
    late.onopen = () => late.send(JSON.stringify({ t: "hello", lastSeq: 1_000_000 }))
    late.onmessage = (e) => resolve(JSON.parse(String(e.data)))
  })
  expect(snapshot.t === "reset" && snapshot.snapshot.members.map((m) => m.slug)).toEqual(["kiko", "ada", "cy", "d1", "d2", "d3", "d4"].map(slug))
  late.close()
  ws.ws.close()
})

test("the room stores only the latest status, and only for members", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  await call(`/status/${room}/ada/working`)
  await call(`/status/${room}/ada/working`)
  await call(`/status/${room}/zed/working`)
  await ws.until((f) => f.t === "status" && f.slug === "ada")
  await Bun.sleep(100)
  expect(ws.frames.filter((f) => f.t === "status").map((f) => (f.t === "status" ? `${f.slug}:${f.state}` : ""))).toEqual(["ada:working"])
  await ws.say("@bob hi")
  const [bob] = await delivered(room, "bob", 1)
  expect(bob!.brief).toContain("- @ada (ada): reads code, working")
  ws.ws.close()
})

test("stop reaches every member", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  ws.send({ t: "stop" })
  const end = Date.now() + 3000
  while (Date.now() < end) {
    const stops = await Promise.all(["kiko", "bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))
    if (stops.every((x) => x === 1)) break
    await Bun.sleep(50)
  }
  expect(await Promise.all(["kiko", "bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))).toEqual([1, 1, 1, 1])
  ws.ws.close()
})

test("a burst whose delivery fails once is retried, and counts as one turn", async () => {
  const { room, ws } = await team()
  const before = ((await call("/turns")) as { turns: number }).turns
  await call(`/fail/${room}/kiko/1`)
  await ws.say("plan the launch")
  // The first delivery throws; the room's retry delivers it to the lead.
  const got = await delivered(room, "kiko", 1)
  expect(got[0]!.envelopes.map((e) => e.body)).toEqual(["plan the launch"])
  expect(((await call("/turns")) as { turns: number }).turns).toBe(before + 1)
  ws.ws.close()
})

test("agent mail that fails to deliver is retried until it arrives", async () => {
  const { room, ws } = await team()
  await call(`/fail/${room}/ada/2`)
  const sent = (await call(`/mail/${room}/bob`, { id: "m-retry-1", to: "ada", text: "@ada can you check the tests", tainted: false })) as { ok: boolean }
  expect(sent.ok).toBe(true)
  // Two failures, then the alarm's retry gets it through.
  const got = await delivered(room, "ada", 1)
  expect(got[0]!.envelopes.map((e) => e.body)).toEqual(["@ada can you check the tests"])
  ws.ws.close()
})

test("an agent hands files and folders to another by reference: shown on the message, listed in the envelope", async () => {
  const { room, ws } = await team()
  for (const path of ["drafts/a.md", "drafts/b.md", "plan.md"]) await call(`/index/${room}?path=${encodeURIComponent(path)}`)
  const sent = (await call(`/mail/${room}/bob`, { id: "m-files-1", to: "ada", text: "here is the draft", tainted: false, files: ["/drafts", "plan.md"] })) as { ok: boolean }
  expect(sent.ok).toBe(true)
  const got = await delivered(room, "ada", 1)
  expect(got[0]!.envelopes[0]!.body).toBe("here is the draft\n(attached: /drafts/a.md (text/markdown, 2 kb), /drafts/b.md (text/markdown, 2 kb), /plan.md (text/markdown, 2 kb). open each with read before you answer about it.)")
  const shown = ws.events().find((e) => e.t === "message" && e.from.kind === "agent" && e.from.slug === "bob")
  expect(shown?.t === "message" && shown.files?.map((f) => f.name)).toEqual(["drafts/a.md", "drafts/b.md", "plan.md"])
  const missing = (await call(`/mail/${room}/bob`, { id: "m-files-2", to: "ada", text: "and this", tainted: false, files: ["nope.md"] })) as { ok: boolean; error: string }
  expect(missing).toEqual({ ok: false, error: "not sent: no such file or folder: /nope.md" })
  ws.ws.close()
})

test("a group starts with /chat.md listing who does what; it is written once", async () => {
  const { room, ws } = await team()
  await ws.say("hi team")
  await delivered(room, "kiko", 1)
  const file = ws.events().find((e) => e.t === "file" && e.file.name === "chat.md")
  expect(file?.t === "file" && file.file.type).toBe("text/markdown")
  const raw = await (await mf.getR2Bucket("FILES")).list()
  const key = raw.objects.find((o) => o.key.includes(room))?.key
  const text = await (await (await mf.getR2Bucket("FILES")).get(key!))!.text()
  expect(text).toBe("# ship the plan\n\ngoal:\n\n## who does what\n- @kiko: leads\n- @bob: plans\n- @ada: reads code\n- @cy:\n\n## decisions\n")
  await ws.say("again")
  await delivered(room, "kiko", 2)
  expect(ws.events().filter((e) => e.t === "file" && e.file.name === "chat.md")).toHaveLength(1)
  ws.ws.close()
})

test("an agent cannot delete a file attached to a message; the human can", async () => {
  const { room, ws } = await team()
  const put = (await call(`/index/${room}?path=${encodeURIComponent("attachments/a1-photo.png")}`)) as { file: { id: string; name: string; size: number; type: string } }
  await call(`/index/${room}?path=loose.md`)
  ws.send({ t: "send", clientId: crypto.randomUUID(), text: "look", files: [put.file] })
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && (e.files?.length ?? 0) > 0))
  const refused = (await call(`/rm/${room}/bob`, { paths: ["attachments/a1-photo.png", "loose.md"], by: "agent" })) as { refused: string | null }
  expect(refused.refused).toContain("/attachments/a1-photo.png is attached to a message")
  // Nothing went: the refusal is for the whole call.
  expect((await call(`/rm/${room}/bob`, { paths: ["loose.md"], by: "agent" })) as { refused: null }).toEqual({ refused: null })
  expect((await call(`/rm/${room}/bob`, { paths: ["attachments/a1-photo.png"], by: "human" })) as { refused: null }).toEqual({ refused: null })
  ws.ws.close()
})

test("adding an agent to a chat with files says so in the chat", async () => {
  const { room, ws } = await team()
  await call(`/index/${room}?path=notes.md`)
  await call(`/index/${room}?path=plan.md`)
  ws.send({ t: "member", op: { op: "add", slug: "dee", name: "dee" } })
  const line = (await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "system" && e.from.reason === "files"))) as Extract<RoomToClient, { t: "events" }>
  const msg = line.events.find((e) => e.t === "message")
  // Two files here, and the group's /chat.md.
  expect(msg?.t === "message" && msg.text).toBe("@dee can now see this chat's 3 files")
  ws.ws.close()
})

test("a private chat's agents are told so on every delivery", async () => {
  const room = fresh()
  await call("/user", { chats: [{ ...chatFor(room, "secret plans", AGENTS.map((a) => a.id)), private: true }], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.say("between us")
  const got = await delivered(room, "kiko", 1)
  expect(got[0]!.home?.private).toBe(true)
  ws.ws.close()
})

const soul = (name: string) => `# ${name}\n\ni plan meals around what's in the fridge.\n\n## what i've learned about working with them\n`

test("in a temporary chat kiko makes an agent only after the human answers", async () => {
  const room = fresh()
  await call("/user", { chats: [{ ...chatFor(room, "new chat", ["kiko"]), temp: true }], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "kiko"))
  await ws.say("i want help with meal prep")
  // Only kiko proposes; a bad handle and a taken one are refused.
  expect(((await call(`/propose/${room}/bob`, { kind: "agent", agent: { name: "chef", handle: "chef", description: "", soul: soul("chef") } })) as { ok: boolean }).ok).toBe(false)
  expect(((await call(`/propose/${room}/kiko`, { kind: "agent", agent: { name: "ada", handle: "ada", description: "", soul: soul("ada") } })) as { error: string }).error).toContain("taken")
  const proposed = (await call(`/propose/${room}/kiko`, { kind: "agent", agent: { name: "chef", handle: "chef", description: "plans your meal prep", soul: soul("chef") } })) as { ok: true; id: string }
  expect(proposed.ok).toBe(true)
  // No human message since the proposal: not yet.
  const early = (await call(`/create/${room}/kiko/${proposed.id}`)) as { ok: boolean; error: string }
  expect(early.error).toContain("wait for their yes")
  await ws.say("yes do it")
  const made = (await call(`/create/${room}/kiko/${proposed.id}`)) as { ok: boolean; text: string }
  expect(made.ok).toBe(true)
  // The same create again returns what the first one made.
  expect(((await call(`/create/${room}/kiko/${proposed.id}`)) as { text: string }).text).toBe(made.text)
  const state = (await call("/userstate")) as { agents: { slug: string }[]; souls: Record<string, string>; chats: { roomId: string; title: string; agents?: string[] }[] }
  expect(state.agents.map((a) => a.slug)).toContain("chef")
  expect(state.souls.chef).toBe(soul("chef"))
  const dm = state.chats.find((c) => c.title === "chef")!
  expect(dm.agents).toEqual(["made-chef"])
  // The temporary chat gets a line that points at the new chat.
  const line = await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "system" && e.from.reason === "created"))
  const goto = line.t === "events" ? line.events.find((e) => e.t === "message") : undefined
  expect(goto?.t === "message" && goto.goto).toBe(dm.roomId)
  // And the new agent hears it was made, so it says hi first.
  const intro = await delivered(dm.roomId as RoomId, "chef", 1)
  expect(intro[0]!.envelopes[0]!.body).toContain("kiko just made you for the human: plans your meal prep")
  ws.ws.close()
})

test("a group from a temporary chat: the chat becomes the group, with its members and kiko's /chat.md", async () => {
  const room = fresh()
  await call("/user", { chats: [{ ...chatFor(room, "new chat", ["kiko"]), temp: true }], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "kiko"))
  await ws.say("a group for launching the app: ada and a new marketer")
  const chatMd = "# launch\n\ngoal: ship the app\n\n## who does what\n- @kiko: leads\n- @ada: code\n- @mia: marketing\n\n## decisions\n"
  const proposed = (await call(`/propose/${room}/kiko`, { kind: "group", title: "launch", members: ["@ada"], agents: [{ name: "mia", handle: "mia", description: "markets the launch", soul: soul("mia") }], chat: chatMd })) as { id: string }
  await ws.say("yes")
  expect(((await call(`/create/${room}/kiko/${proposed.id}`)) as { ok: boolean }).ok).toBe(true)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "mia"))
  expect(ws.members().map((m) => m.slug).sort()).toEqual(["ada", "kiko", "mia"])
  const state = (await call("/userstate")) as { chats: { roomId: string; title: string; temp?: true; agents?: string[] }[] }
  const chat = state.chats.find((c) => c.roomId === room)!
  expect(chat).toMatchObject({ title: "launch", agents: ["kiko", "id-ada", "made-mia"] })
  expect(chat.temp).toBeUndefined()
  const files = await (await mf.getR2Bucket("FILES")).list()
  const key = files.objects.filter((o) => o.key.includes(room)).at(-1)!.key
  expect(await (await (await mf.getR2Bucket("FILES")).get(key))!.text()).toBe(chatMd)
  ws.ws.close()
})

test("a quote tells the agent exactly which words the human answers", async () => {
  const { room, ws } = await team()
  await ws.say("first")
  await delivered(room, "kiko", 1)
  const posted = (await call(`/post/${room}/bob`)) as boolean
  expect(posted).toBe(true)
  const bubble = await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "agent"))
  const target = bubble.t === "events" ? bubble.events.find((e) => e.t === "message")! : null
  ws.send({ t: "send", clientId: crypto.randomUUID(), text: "why?", replyTo: target!.t === "message" ? target!.id : "", quote: "help" })
  // A reply to bob's bubble reaches bob, though kiko leads.
  const got = await delivered(room, "bob", 1)
  expect(got[0]!.envelopes[0]!.body).toBe('(replying to @bob, about this part: "help")\nwhy?')
  ws.ws.close()
})
