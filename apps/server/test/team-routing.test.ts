import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import type { Agent, AgentSlug, Chat, Member, RoomEvent, RoomId, RoomToClient } from "@yuki/protocol"
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
const received = async (room: RoomId, who: string) => ((await call(`/calls/${room}/${who}`)) as { received: Received[]; stops: number; answers: { id: string; answer: string }[] })

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

/** A room whose chat was created with bob, ada, and cy. yuki is seeded first and leads. */
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
  Object.fromEntries(await Promise.all(["yuki", "bob", "ada", "cy"].map(async (s) => [s, (await received(room, s)).received.length])))

test("a chat created with agents seeds yuki as the lead, then them", async () => {
  const { ws } = await team()
  await ws.until(() => ws.members().length === 4)
  expect(ws.members().map((m) => [m.slug, m.lead, m.role ?? null])).toEqual([
    ["yuki", true, null],
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

test("a chat created without agents gets yuki as its lead", async () => {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "solo")], agents: [] })
  const ws = await Socket.open(room)
  await ws.until(() => ws.members().length === 1)
  expect(ws.members()).toEqual([{ slug: slug("yuki"), name: "Yuki", lead: true, model: "opencode-go/muse-spark-1.3-contributor" }])
  ws.ws.close()
})

test("a group with the built-in agent seeds yuki too: the client names it by its slug, and no stored agent has that id", async () => {
  const room = fresh()
  await call("/user", { chats: [chatFor(room, "with yuki", ["yuki", AGENTS[1]!.id])], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until(() => ws.members().length === 2)
  expect(ws.members().map((m) => [m.slug, m.lead])).toEqual([
    ["yuki", true],
    ["ada", false],
  ])
  ws.ws.close()
})

test("an untagged burst reaches only the lead; the others are not woken, even after the lead's run ends", async () => {
  const { room, ws } = await team()
  await ws.say("anyone around?")
  await delivered(room, "yuki", 1)
  await call(`/end/${room}/yuki/yuki:r1`)
  await Bun.sleep(500)
  // Every member reads the whole chat in its next run's memory, so nobody needs a run of its own now.
  expect(await counts(room)).toEqual({ yuki: 1, bob: 0, ada: 0, cy: 0 })
  ws.ws.close()
})

const memory = async (room: RoomId, seqs: number[]) => ((await call(`/memory/${room}`, seqs)) as { view: string }).view

test("untagged reaches only the lead, @ada only ada, @all everyone, and every memory view carries the whole chat", async () => {
  const { room, ws } = await team()
  await ws.say("hello team")
  await delivered(room, "yuki", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ yuki: 1, bob: 0, ada: 0, cy: 0 })
  const first = (await received(room, "yuki")).received[0]!
  expect(first.envelopes.map((e) => e.body)).toEqual(["hello team"])
  expect(first.home).toMatchObject({ slug: "yuki", lead: true })

  await ws.say("@ada your turn")
  const [toAda] = await delivered(room, "ada", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ yuki: 1, bob: 0, ada: 1, cy: 0 })
  expect(toAda!.envelopes.map((e) => e.body)).toEqual(["@ada your turn"])
  expect(toAda!.home).toMatchObject({ slug: "ada", lead: false })
  // She was not sent "hello team", yet her run's <memory> view holds it. Her own envelope is not repeated there.
  const hers = await memory(room, toAda!.envelopes.map((e) => e.seq))
  expect(hers).toContain("human: [")
  expect(hers).toContain("hello team")
  expect(hers).not.toContain("your turn")
  expect(toAda!.brief).not.toContain("hello team")
  expect(toAda!.brief).toContain("room goal: ship the plan")
  expect(toAda!.brief).toContain("- @yuki (Yuki): lead")
  expect(toAda!.brief).toContain("- @bob (bob): plans, idle")

  await ws.say("@all ping")
  await delivered(room, "cy", 1)
  await delivered(room, "yuki", 2)
  await delivered(room, "bob", 1)
  await delivered(room, "ada", 2)
  expect(await counts(room)).toEqual({ yuki: 2, bob: 1, ada: 2, cy: 1 })
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

test("an ask is delivered, its answer is pushed to the waiting tool and not the inbox, and a reply after it closes is delivered", async () => {
  const { room, ws } = await team()
  await ws.say("@ada start")
  await delivered(room, "ada", 1)
  expect(((await call(`/ask/${room}/ada`, { id: "q1", to: "bob", text: "what is the port?" })) as { ok: boolean }).ok).toBe(true)
  const [question] = await delivered(room, "bob", 1)
  expect(question!.envelopes.map((e) => e.body)).toEqual(["what is the port?"])
  expect(await call(`/askstate/${room}/q1`)).toEqual({ state: "open", answer: null })
  // bob answers with send_message: the chat shows it, ada's tool reads it, and ada's inbox stays as it was.
  await call(`/mail/${room}/bob`, { id: "a1", to: "ada", text: "8797" })
  expect(await call(`/askstate/${room}/q1`)).toEqual({ state: "answered", answer: "8797" })
  await Bun.sleep(500)
  expect((await counts(room)).ada).toBe(1)
  expect((await received(room, "ada")).answers).toEqual([{ id: "q1", answer: "8797" }])
  // An ask that timed out is closed; a later reply is an ordinary message.
  await call(`/ask/${room}/ada`, { id: "q2", to: "bob", text: "and the host?" })
  expect(await call(`/closeask/${room}/q2`)).toEqual({ state: "closed", answer: null })
  await call(`/mail/${room}/bob`, { id: "a2", to: "ada", text: "localhost" })
  await delivered(room, "ada", 2)
  expect((await received(room, "ada")).answers).toEqual([{ id: "q1", answer: "8797" }])
  expect(((await call(`/ask/${room}/ada`, { id: "q3", to: "all", text: "anyone?" })) as { ok: boolean }).ok).toBe(false)
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
  expect(await counts(room)).toEqual({ yuki: 0, bob: 0, ada: 0, cy: 1 })
  ws.ws.close()
})

test("add, rename, and remove members, with the limit of 8, and yuki always stays", async () => {
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

  // yuki is the chief: it cannot be removed, and it stays the lead.
  ws.send({ t: "member", op: { op: "remove", slug: "yuki" } })
  await ws.until((f) => f.t === "member_refused" && f.reason === "chief")
  expect(ws.members().filter((m) => m.lead).map((m) => m.slug)).toEqual([slug("yuki")])

  ws.send({ t: "member", op: { op: "remove", slug: "bob" } })
  await ws.until(() => !ws.members().some((m) => m.slug === "bob"))
  expect((await received(room, "bob")).stops).toBe(1)

  // A tag for a removed member counts as no tag, so it reaches the lead.
  await ws.say("@bob are you there")
  await delivered(room, "yuki", 1)
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
  expect(snapshot.t === "reset" && snapshot.snapshot.members.map((m) => m.slug)).toEqual(["yuki", "ada", "cy", "d1", "d2", "d3", "d4"].map(slug))
  late.close()
  ws.ws.close()
})

test("agent mail records who it was for, so the client folds it by fact, and the human's message records nothing", async () => {
  const { room, ws } = await team()
  await ws.say("@ada start")
  await delivered(room, "ada", 1)
  await call(`/mail/${room}/ada`, { id: "m1", to: "bob", text: "over to you" })
  await call(`/mail/${room}/ada`, { id: "m2", to: "all", text: "heads up" })
  const late = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
  const snapshot = await new Promise<RoomToClient>((resolve) => {
    late.onopen = () => late.send(JSON.stringify({ t: "hello", lastSeq: 1_000_000 }))
    late.onmessage = (e) => resolve(JSON.parse(String(e.data)))
  })
  late.close()
  if (snapshot.t !== "reset") throw new Error(`expected a reset, got ${snapshot.t}`)
  expect(snapshot.snapshot.messages.map((m) => [m.from.kind, m.text, m.to ?? null])).toEqual([
    ["human", "@ada start", null],
    ["agent", "@bob over to you", "bob"],
    ["agent", "@all heads up", "all"],
  ])
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
    const stops = await Promise.all(["yuki", "bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))
    if (stops.every((x) => x === 1)) break
    await Bun.sleep(50)
  }
  expect(await Promise.all(["yuki", "bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))).toEqual([1, 1, 1, 1])
  ws.ws.close()
})

test("a burst whose delivery fails once is retried, and counts as one turn", async () => {
  const { room, ws } = await team()
  const before = ((await call("/turns")) as { turns: number }).turns
  await call(`/fail/${room}/yuki/1`)
  await ws.say("plan the launch")
  // The first delivery throws; the room's retry delivers it to the lead.
  const got = await delivered(room, "yuki", 1)
  expect(got[0]!.envelopes.map((e) => e.body)).toEqual(["plan the launch"])
  expect(((await call("/turns")) as { turns: number }).turns).toBe(before + 1)
  ws.ws.close()
})

test("mail an agent refuses costs its root nothing and the sender is told once", async () => {
  const { room } = await team()
  await call(`/refusenext/${room}/ada/30`)
  for (let i = 0; i < 30; i++) {
    const sent = (await call(`/mail/${room}/bob`, { id: `big-${i}`, to: "ada", text: `part ${i}` })) as { ok: boolean }
    expect(sent.ok).toBe(true)
  }
  const end = Date.now() + 15_000
  const notices = async () => (await received(room, "bob")).received.flatMap((r) => r.envelopes).filter((e) => e.from.kind === "system")
  while ((await notices()).length < 30) {
    if (Date.now() > end) throw new Error(`bob got ${(await notices()).length} notices`)
    await Bun.sleep(100)
  }
  const told = await notices()
  expect(new Set(told.map((e) => e.id)).size).toBe(30)
  expect(told[0]!.body).toContain("@ada")
  expect(told[0]!.body).toContain("too large")
  expect((await received(room, "ada")).received).toEqual([])
  // 30 refused sends must not have used the root's 40 deliveries: 15 more still go through.
  for (let i = 0; i < 15; i++) {
    const sent = (await call(`/mail/${room}/bob`, { id: `ok-${i}`, to: "ada", text: `again ${i}` })) as { ok: boolean; error?: string }
    expect(sent).toEqual({ ok: true, to: ["ada"] })
  }
  await delivered(room, "ada", 15)
  await Bun.sleep(300)
  expect((await notices()).length).toBe(30)
})

test("agent mail that fails to deliver is retried until it arrives", async () => {
  const { room, ws } = await team()
  await call(`/fail/${room}/ada/2`)
  const sent = (await call(`/mail/${room}/bob`, { id: "m-retry-1", to: "ada", text: "@ada can you check the tests" })) as { ok: boolean }
  expect(sent.ok).toBe(true)
  // Two failures, then the alarm's retry gets it through.
  const got = await delivered(room, "ada", 1)
  expect(got[0]!.envelopes.map((e) => e.body)).toEqual(["@ada can you check the tests"])
  ws.ws.close()
})

test("an agent's send_message carries text only: no files on the message, none in the envelope", async () => {
  const { room, ws } = await team()
  await call(`/index/${room}?path=plan.md`)
  // An older agent could still pass files. The room drops them.
  const sent = (await call(`/mail/${room}/bob`, { id: "m-files-1", to: "ada", text: "the plan is in /plan.md", files: ["plan.md"] })) as { ok: boolean }
  expect(sent.ok).toBe(true)
  const got = await delivered(room, "ada", 1)
  expect(got[0]!.envelopes[0]!.body).toBe("the plan is in /plan.md")
  const shown = ws.events().find((e) => e.t === "message" && e.from.kind === "agent" && e.from.slug === "bob")
  expect(shown?.t === "message" && shown.files).toBeUndefined()
  ws.ws.close()
})

test("a group starts with /chat.md listing who does what; it is written once", async () => {
  const { room, ws } = await team()
  await ws.say("hi team")
  await delivered(room, "yuki", 1)
  const file = ws.events().find((e) => e.t === "file" && e.file.name === "chat.md")
  expect(file?.t === "file" && file.file.type).toBe("text/markdown")
  const raw = await (await mf.getR2Bucket("FILES")).list()
  const key = raw.objects.find((o) => o.key.includes(room))?.key
  const text = await (await (await mf.getR2Bucket("FILES")).get(key!))!.text()
  expect(text).toBe("# ship the plan\n\ngoal:\n\n## who does what\n- @yuki: leads\n- @bob: plans\n- @ada: reads code\n- @cy:\n\n## decisions\n")
  await ws.say("again")
  await delivered(room, "yuki", 2)
  expect(ws.events().filter((e) => e.t === "file" && e.file.name === "chat.md")).toHaveLength(1)
  ws.ws.close()
})

test("a human's attachment shows on the message and is listed in the lead's envelope", async () => {
  const { room, ws } = await team()
  const put = (await call(`/index/${room}?path=${encodeURIComponent("attachments/a1-photo.png")}`)) as { file: { id: string; name: string; size: number; type: string } }
  ws.send({ t: "send", clientId: crypto.randomUUID(), text: "look", files: [put.file] })
  const frame = (await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && (e.files?.length ?? 0) > 0))) as Extract<RoomToClient, { t: "events" }>
  const shown = frame.events.find((e) => e.t === "message")
  expect(shown?.t === "message" && shown.files?.map((f) => f.name)).toEqual(["attachments/a1-photo.png"])
  const got = await delivered(room, "yuki", 1)
  const body = got.flatMap((r) => r.envelopes.map((e) => e.body)).find((b) => b.startsWith("look"))
  expect(body).toStartWith("look\n(attached: /attachments/a1-photo.png (")
  expect(body).toEndWith("open each with read before you answer about it.)")
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
  const got = await delivered(room, "yuki", 1)
  expect(got[0]!.home?.private).toBe(true)
  ws.ws.close()
})

const soul = (name: string) => `# ${name}\n\ni plan meals around what's in the fridge.\n\n## what i've learned about working with them\n`

test("in a temporary chat yuki makes an agent from its proposal", async () => {
  const room = fresh()
  await call("/user", { chats: [{ ...chatFor(room, "new chat", ["yuki"]), temp: true }], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "yuki"))
  await ws.say("i want help with meal prep")
  // Only yuki proposes; a bad handle and a taken one are refused.
  expect(((await call(`/propose/${room}/bob`, { kind: "agent", agent: { name: "chef", handle: "chef", description: "", soul: soul("chef") } })) as { ok: boolean }).ok).toBe(false)
  expect(((await call(`/propose/${room}/yuki`, { kind: "agent", agent: { name: "ada", handle: "ada", description: "", soul: soul("ada") } })) as { error: string }).error).toContain("taken")
  const proposed = (await call(`/propose/${room}/yuki`, { kind: "agent", agent: { name: "chef", handle: "chef", description: "plans your meal prep", soul: soul("chef") } })) as { ok: true; id: string }
  expect(proposed.ok).toBe(true)
  const made = (await call(`/create/${room}/yuki/${proposed.id}`)) as { ok: boolean; text: string }
  expect(made.ok).toBe(true)
  // The same create again returns what the first one made.
  expect(((await call(`/create/${room}/yuki/${proposed.id}`)) as { text: string }).text).toBe(made.text)
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
  expect(intro[0]!.envelopes[0]!.body).toContain("yuki just made you for the human: plans your meal prep")
  ws.ws.close()
})

test("a group from a temporary chat: the chat becomes the group, with its members and yuki's /chat.md", async () => {
  const room = fresh()
  await call("/user", { chats: [{ ...chatFor(room, "new chat", ["yuki"]), temp: true }], agents: AGENTS })
  const ws = await Socket.open(room)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "yuki"))
  await ws.say("a group for launching the app: ada and a new marketer")
  const chatMd = "# launch\n\ngoal: ship the app\n\n## who does what\n- @yuki: leads\n- @ada: code\n- @mia: marketing\n\n## decisions\n"
  const proposed = (await call(`/propose/${room}/yuki`, { kind: "group", title: "launch", members: ["@ada"], agents: [{ name: "mia", handle: "mia", description: "markets the launch", soul: soul("mia") }], chat: chatMd })) as { id: string }
  expect(((await call(`/create/${room}/yuki/${proposed.id}`)) as { ok: boolean }).ok).toBe(true)
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "member" && e.member.slug === "mia"))
  expect(ws.members().map((m) => m.slug).sort()).toEqual(["ada", "mia", "yuki"])
  const state = (await call("/userstate")) as { chats: { roomId: string; title: string; temp?: true; agents?: string[] }[] }
  const chat = state.chats.find((c) => c.roomId === room)!
  expect(chat).toMatchObject({ title: "launch", agents: ["yuki", "id-ada", "made-mia"] })
  expect(chat.temp).toBeUndefined()
  const files = await (await mf.getR2Bucket("FILES")).list()
  const key = files.objects.filter((o) => o.key.includes(room)).at(-1)!.key
  expect(await (await (await mf.getR2Bucket("FILES")).get(key))!.text()).toBe(chatMd)
  ws.ws.close()
})

test("a quote tells the agent exactly which words the human answers", async () => {
  const { room, ws } = await team()
  await ws.say("first")
  await delivered(room, "yuki", 1)
  const posted = (await call(`/post/${room}/bob`)) as boolean
  expect(posted).toBe(true)
  const bubble = await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "agent"))
  const target = bubble.t === "events" ? bubble.events.find((e) => e.t === "message")! : null
  ws.send({ t: "send", clientId: crypto.randomUUID(), text: "why?", replyTo: target!.t === "message" ? target!.id : "", quote: "help" })
  // A reply to bob's bubble reaches bob, though yuki leads.
  const got = await delivered(room, "bob", 1)
  expect(got[0]!.envelopes[0]!.body).toBe('(replying to @bob, about this part: "help")\nwhy?')
  ws.ws.close()
})

// The endgame pass on the agent-to-agent loop (docs/research/endgame-audit.md, lane B).

const askOf = async (room: RoomId, id: string) => {
  const { state, answer } = (await call(`/askstate/${room}/${id}`)) as { state: string; answer: string | null }
  return { state, answer }
}
const until = async (what: string, test: () => Promise<boolean>, ms = 6000) => {
  const end = Date.now() + ms
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(100)
  }
}

test("a question sent with ask never settles the asker's own open ask; asking back is refused; a replayed answer answers nothing new", async () => {
  const { room, ws } = await team()
  expect(((await call(`/ask/${room}/ada`, { id: "x1", to: "bob", text: "which port?" })) as { ok: boolean }).ok).toBe(true)
  // bob asks ada back while ada waits on him: refused, and ada's ask stays open.
  const back = (await call(`/ask/${room}/bob`, { id: "x2", to: "ada", text: "which server?" })) as { ok: boolean; error?: string }
  expect(back.ok).toBe(false)
  expect(back.error).toContain("@ada is waiting for your answer")
  expect(await askOf(room, "x1")).toEqual({ state: "open", answer: null })
  // cy's question to ada does not answer ada's ask of bob either.
  await call(`/ask/${room}/cy`, { id: "x3", to: "ada", text: "are you there?" })
  expect(await askOf(room, "x1")).toEqual({ state: "open", answer: null })
  // bob's send_message answers it, once.
  await call(`/mail/${room}/bob`, { id: "x-answer", to: "ada", text: "8797" })
  expect(await askOf(room, "x1")).toEqual({ state: "answered", answer: "8797" })
  await call(`/ask/${room}/ada`, { id: "x4", to: "bob", text: "and the host?" })
  // The same tool call replayed after a crash must not answer the new ask.
  await call(`/mail/${room}/bob`, { id: "x-answer", to: "ada", text: "8797" })
  expect(await askOf(room, "x4")).toEqual({ state: "open", answer: null })
  ws.ws.close()
})

test("one agent has two asks open at once, to two teammates, and each answer reaches the ask it belongs to", async () => {
  const { room, ws } = await team()
  const asked = (await Promise.all([
    call(`/ask/${room}/ada`, { id: "m1", to: "bob", text: "which port?" }),
    call(`/ask/${room}/ada`, { id: "m2", to: "cy", text: "which host?" }),
  ])) as { ok: boolean }[]
  expect(asked.map((a) => a.ok)).toEqual([true, true])
  expect(await Promise.all([askOf(room, "m1"), askOf(room, "m2")])).toEqual([
    { state: "open", answer: null },
    { state: "open", answer: null },
  ])
  // cy answers first. Only cy's ask settles; bob's stays open.
  await call(`/mail/${room}/cy`, { id: "m-cy", to: "ada", text: "localhost" })
  expect(await Promise.all([askOf(room, "m1"), askOf(room, "m2")])).toEqual([
    { state: "open", answer: null },
    { state: "answered", answer: "localhost" },
  ])
  await call(`/mail/${room}/bob`, { id: "m-bob", to: "ada", text: "8797" })
  expect(await Promise.all([askOf(room, "m1"), askOf(room, "m2")])).toEqual([
    { state: "answered", answer: "8797" },
    { state: "answered", answer: "localhost" },
  ])
  await until("both pushed answers", async () => (await received(room, "ada")).answers.length === 2)
  const pushed = (await received(room, "ada")).answers
  expect(pushed.find((a) => a.id === "m1")?.answer).toBe("8797")
  expect(pushed.find((a) => a.id === "m2")?.answer).toBe("localhost")
  // Neither answer was delivered to ada's inbox.
  expect((await counts(room)).ada).toBe(0)
  ws.ws.close()
})

test("a run that read a question and answered in a plain reply answers the ask; past the wait, the reply goes as mail", async () => {
  const { room, ws } = await team()
  await call(`/ask/${room}/ada`, { id: "p1", to: "bob", text: "what is the plan?" })
  const [question] = await delivered(room, "bob", 1)
  const heard = question!.envelopes.map((e) => e.id)
  // A run that did not read the question answers nothing.
  await call(`/post/${room}/bob/bob:other`, { text: "unrelated" })
  await call(`/end/${room}/bob/bob:other`, [])
  expect(await askOf(room, "p1")).toEqual({ state: "open", answer: null })
  await call(`/post/${room}/bob/bob:p1`, { text: "ship friday" })
  await call(`/post/${room}/bob/bob:p1`, { text: "then rest", index: 1 })
  await call(`/end/${room}/bob/bob:p1`, heard)
  expect(await askOf(room, "p1")).toEqual({ state: "answered", answer: "ship friday\n\nthen rest" })
  await until("the pushed answer", async () => (await received(room, "ada")).answers.length === 1)
  // A clean run's reply leaves the asker's run clean.
  expect((await received(room, "ada")).answers).toEqual([{ id: "p1", answer: "ship friday\n\nthen rest" }])
  // A repeat of the run's end answers nothing twice.
  await call(`/end/${room}/bob/bob:p1`, heard)
  expect((await received(room, "ada")).answers).toHaveLength(1)

  // ada stopped waiting on her second question. bob's plain reply reaches her as mail.
  await call(`/ask/${room}/ada`, { id: "p2", to: "bob", text: "and the date?" })
  const second = (await delivered(room, "bob", 2))[1]!
  expect(await call(`/closeask/${room}/p2`)).toMatchObject({ state: "closed", answer: null })
  await call(`/post/${room}/bob/bob:p2`, { text: "the 9th" })
  await call(`/end/${room}/bob/bob:p2`, second.envelopes.map((e) => e.id))
  const mail = await delivered(room, "ada", 1)
  expect(mail[0]!.envelopes.map((e) => [e.from, e.body])).toEqual([[{ kind: "agent", slug: "bob" }, "the 9th"]])
  expect((await received(room, "ada")).answers).toHaveLength(1)
  ws.ws.close()
})

test("a batch dropped for a missing key answers the ask it carried with why", async () => {
  const { room, ws } = await team()
  await call(`/ask/${room}/ada`, { id: "k1", to: "bob", text: "status?" })
  const [question] = await delivered(room, "bob", 1)
  await call(`/noprovider/${room}/bob`, question!.envelopes.map((e) => e.id))
  const state = await askOf(room, "k1")
  expect(state.state).toBe("answered")
  expect(state.answer).toContain("@bob cannot run")
  await until("the pushed reason", async () => (await received(room, "ada")).answers.length === 1)
  ws.ws.close()
})

test("mail held for a busy agent never rewrites the chain of its run; the next run takes it", async () => {
  const { room, ws } = await team()
  await ws.say("@bob go")
  const [human] = await delivered(room, "bob", 1)
  const root = human!.envelopes[0]!.rootId
  await call(`/status/${room}/bob/working`)
  // ada writes to bob mid-run. ada was never handed anything, so hers is an `auto` chain.
  await call(`/mail/${room}/ada`, { id: "c1", to: "bob", text: "fyi" })
  await delivered(room, "bob", 2)
  // bob's run sends on the human's chain, not ada's.
  await call(`/mail/${room}/bob`, { id: "c2", to: "cy", text: "please help" })
  const [toCy] = await delivered(room, "cy", 1)
  expect(toCy!.envelopes.map((e) => ({ rootId: e.rootId, hop: e.hop, origin: e.origin }))).toEqual([{ rootId: root, hop: 1, origin: "human" }])
  // The run ends; the run that reads ada's mail is on her chain.
  await call(`/end/${room}/bob/bob:c`)
  await call(`/mail/${room}/bob`, { id: "c3", to: "cy", text: "thanks" })
  const toCy2 = (await delivered(room, "cy", 2))[1]!
  expect(toCy2.envelopes.map((e) => ({ rootId: e.rootId, hop: e.hop, origin: e.origin }))).toEqual([{ rootId: "agent:ada", hop: 2, origin: "auto" }])
  ws.ws.close()
})

test("a human message warns only the busy agents it is for, and mail waits only for agents the open burst addresses", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  await call(`/status/${room}/ada/working`)
  await call(`/status/${room}/cy/working`)
  // A fragment keeps the burst open for 2.5 s.
  await ws.say("@ada wait for it,")
  await until("ada's warning", async () => (await received(room, "ada")).coming === 1)
  expect((await received(room, "cy")).coming).toBe(0)
  // Mail to cy goes at once. Mail to ada waits for the human's message.
  await call(`/mail/${room}/bob`, { id: "h1", to: "cy", text: "for cy" })
  await call(`/mail/${room}/bob`, { id: "h2", to: "ada", text: "for ada" })
  await delivered(room, "cy", 1)
  expect((await received(room, "ada")).received).toHaveLength(0)
  const got = await delivered(room, "ada", 2)
  expect(got.map((r) => r.envelopes.map((e) => e.body))).toEqual([["@ada wait for it,"], ["for ada"]])
  ws.ws.close()
})

test("a burst the day's limit refused releases the agents it warned and the mail it held", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  await call(`/status/${room}/ada/working`)
  await call("/refuse/1")
  try {
    await ws.say("@ada one more,")
    await until("ada's warning", async () => (await received(room, "ada")).coming === 1)
    await call(`/mail/${room}/bob`, { id: "r1", to: "ada", text: "held behind the burst" })
    await Bun.sleep(300)
    expect((await received(room, "ada")).received).toHaveLength(0)
    // The burst closes, refused: ada hears it is gone, and bob's mail reaches her.
    const got = await delivered(room, "ada", 1)
    expect(got[0]!.envelopes.map((e) => e.body)).toEqual(["held behind the burst"])
    await until("ada told the human message is gone", async () => (await received(room, "ada")).gone === 1)
  } finally {
    await call("/refuse/0")
  }
  ws.ws.close()
})

test("a task an agent makes in the human's work wakes its owner with the human's origin and root", async () => {
  const { room, ws } = await team()
  await ws.say("@yuki plan it")
  const [human] = await delivered(room, "yuki", 1)
  ws.send({ t: "task", op: { op: "create", id: "w1", title: "first", owner: "ada" } })
  await ws.until((f) => f.t === "events" && f.events.some((e) => e.t === "task" && e.task.id === "w1"))
  expect(((await call(`/task/${room}/yuki`, { op: "create_task", id: "w2", title: "second", owner: "bob", dependsOn: ["w1"] })) as { ok: boolean }).ok).toBe(true)
  ws.send({ t: "task", op: { op: "update", id: "w1", status: "done" } })
  const [wake] = await delivered(room, "bob", 1)
  expect(wake!.envelopes.map((e) => ({ id: e.id, rootId: e.rootId, origin: e.origin }))).toEqual([{ id: "unblocked:w2", rootId: human!.envelopes[0]!.rootId, origin: "human" }])
  ws.ws.close()
})

test("typing covers the whole run, tools included, and the chat list is touched once per run", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 4)
  const touches = async () => ((await call("/touches")) as { touches: number }).touches
  await Bun.sleep(300)
  const before = await touches()
  for (const state of ["typing", "working", "typing", "working", "typing"]) await call(`/status/${room}/ada/${state}`)
  await call(`/post/${room}/ada/ada:t1`, { text: "one" })
  await call(`/post/${room}/ada/ada:t1`, { text: "two", index: 1 })
  await call(`/end/${room}/ada/ada:t1`)
  await Bun.sleep(300)
  const typing = ws.frames.filter((f) => f.t === "typing").map((f) => (f.t === "typing" ? f.who.join(",") : ""))
  expect(typing).toEqual(["ada", ""])
  expect((await touches()) - before).toBe(1)
  ws.ws.close()
})
