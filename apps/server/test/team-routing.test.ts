import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import type { Agent, AgentSlug, Chat, Member, RoomEvent, RoomId, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { MISSED_HEADER } from "../src/room/brief"
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

/** A room whose chat was created with bob, ada, and cy. bob is first, so bob leads. */
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
  Object.fromEntries(await Promise.all(["bob", "ada", "cy"].map(async (s) => [s, (await received(room, s)).received.length])))

test("a chat created with agents seeds them as members, the first as lead", async () => {
  const { ws } = await team()
  await ws.until(() => ws.members().length === 3)
  expect(ws.members().map((m) => [m.slug, m.lead, m.role ?? null])).toEqual([
    ["bob", true, "plans"],
    ["ada", false, "reads code"],
    ["cy", false, null],
  ])
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
  await delivered(room, "bob", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ bob: 1, ada: 0, cy: 0 })
  await call(`/end/${room}/bob/bob:r1`)
  const [toAda] = await delivered(room, "ada", 1)
  await delivered(room, "cy", 1)
  expect(toAda!.envelopes.map((e) => e.body)).toEqual(["anyone around?"])
  expect(toAda!.brief).toContain("already answered this")
  // A second end of the same run delivers nothing more.
  await call(`/end/${room}/bob/bob:r1`)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ bob: 1, ada: 1, cy: 1 })
  ws.ws.close()
})

test("untagged reaches only the lead, @ada only ada, @all everyone, and ada's next brief carries what she missed", async () => {
  const { room, ws } = await team()
  await ws.say("hello team")
  await delivered(room, "bob", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ bob: 1, ada: 0, cy: 0 })
  const first = (await received(room, "bob")).received[0]!
  expect(first.envelopes.map((e) => e.body)).toEqual(["hello team"])
  expect(first.home).toMatchObject({ slug: "bob", lead: true, role: "plans" })

  await ws.say("@ada your turn")
  const [toAda] = await delivered(room, "ada", 1)
  await Bun.sleep(300)
  expect(await counts(room)).toEqual({ bob: 1, ada: 1, cy: 0 })
  expect(toAda!.envelopes.map((e) => e.body)).toEqual(["@ada your turn"])
  expect(toAda!.home).toMatchObject({ slug: "ada", lead: false })
  // She missed "hello team". Her own envelope is not repeated in the brief.
  const missed = toAda!.brief.slice(toAda!.brief.indexOf(MISSED_HEADER))
  expect(missed).toContain("human: hello team")
  expect(missed).not.toContain("your turn")
  expect(toAda!.brief).toContain("room goal: ship the plan")
  expect(toAda!.brief).toContain("- @bob (bob): lead, plans, idle")

  await ws.say("@all ping")
  await delivered(room, "cy", 1)
  await delivered(room, "bob", 2)
  await delivered(room, "ada", 2)
  expect(await counts(room)).toEqual({ bob: 2, ada: 2, cy: 1 })
  const adaAgain = (await received(room, "ada")).received[1]!
  // Nothing new happened since ada's last delivery, so her brief has no missed section.
  expect(adaAgain.brief).not.toContain(MISSED_HEADER)
  const cy = (await received(room, "cy")).received[0]!
  expect(cy.brief).toContain("human: hello team")
  expect(cy.brief).toContain("human: @ada your turn")
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
  // A message of the same burst addressed to someone else is context, not lost.
  expect(ada!.brief).toContain("human: @cy two")
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
  expect(await counts(room)).toEqual({ bob: 0, ada: 0, cy: 1 })
  ws.ws.close()
})

test("add, rename, and remove members, with the limit of 8", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 3)
  for (const s of ["d1", "d2", "d3", "d4", "d5"]) ws.send({ t: "member", op: { op: "add", slug: s, name: s } })
  await ws.until(() => ws.members().length === 8)
  ws.send({ t: "member", op: { op: "add", slug: "d6", name: "d6" } })
  const refused = await ws.until((f) => f.t === "member_refused")
  expect(refused).toEqual({ t: "member_refused", op: { op: "add", slug: slug("d6"), name: "d6" }, reason: "limit" })
  ws.send({ t: "member", op: { op: "add", slug: "all", name: "all" } })
  await ws.until((f) => f.t === "member_refused" && f.reason === "reserved")

  ws.send({ t: "member", op: { op: "rename", slug: "ada", name: "ada lovelace" } })
  await ws.until(() => ws.members().find((m) => m.slug === "ada")?.name === "ada lovelace")

  // Removing the lead makes the member who joined next the lead.
  ws.send({ t: "member", op: { op: "remove", slug: "bob" } })
  await ws.until(() => ws.members().find((m) => m.slug === "ada")?.lead === true)
  expect(ws.members().filter((m) => m.lead).map((m) => m.slug)).toEqual([slug("ada")])
  expect((await received(room, "bob")).stops).toBe(1)

  // An untagged message now reaches the new lead, and a tag for a removed member counts as no tag.
  await ws.say("@bob are you there")
  await delivered(room, "ada", 1)
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
  expect(snapshot.t === "reset" && snapshot.snapshot.members.map((m) => m.slug)).toEqual(["ada", "cy", "d1", "d2", "d3", "d4", "d5"].map(slug))
  late.close()
  ws.ws.close()
})

test("the room stores only the latest status, and only for members", async () => {
  const { room, ws } = await team()
  await ws.until(() => ws.members().length === 3)
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
  await ws.until(() => ws.members().length === 3)
  ws.send({ t: "stop" })
  const end = Date.now() + 3000
  while (Date.now() < end) {
    const stops = await Promise.all(["bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))
    if (stops.every((x) => x === 1)) break
    await Bun.sleep(50)
  }
  expect(await Promise.all(["bob", "ada", "cy"].map(async (s) => (await received(room, s)).stops))).toEqual([1, 1, 1])
  ws.ws.close()
})

test("a burst whose delivery fails once is retried, and counts as one turn", async () => {
  const { room, ws } = await team()
  const before = ((await call("/turns")) as { turns: number }).turns
  await call(`/fail/${room}/bob/1`)
  await ws.say("plan the launch")
  // The first delivery throws; the room's retry delivers it.
  const got = await delivered(room, "bob", 1)
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
