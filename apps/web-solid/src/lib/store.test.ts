import { describe, expect, test } from "bun:test"
import type { AgentSlug, MessageId, Reaction as WireReaction, RoomEvent } from "@kiko/protocol"
import * as fixtures from "@kiko/protocol/fixtures"
import { createMockRoom, createMockUser } from "../sync/mock-room"
import { createApp, firstUnread, nextReaction, reactionChips, toChatMessage } from "./store"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await sleep(1)
  }
}

const human = { kind: "human" } as const
const ada = { kind: "agent", slug: fixtures.ada } as const
const bob = { kind: "agent", slug: fixtures.bob } as const

let users = 0

/** The app over a mock room and user, with a memory warm tier. */
async function boot(events?: readonly RoomEvent[]) {
  // A first connect gets the snapshot, which is the only place the mock keeps its members.
  const room = createMockRoom({ ...(events ? { events } : {}), resetAfter: 0 })
  const other = createMockRoom({ events: [] })
  const user = createMockUser()
  const app = createApp({
    transport: async () => ({ user: user.connect, room: (id) => (id === fixtures.roomId ? room.connect : other.connect) }),
    warm: { idb: null },
    backoff: { baseMs: 5, maxMs: 20 },
  })
  app.selectThread(fixtures.roomId)
  await app.start(`u${++users}`)
  await until(() => app.room()?.state.connection === "open" && app.activeMessages().length > 0)
  await until(() => app.room()!.state.seq === room.log[room.log.length - 1].seq)
  return { app, room, other, user }
}

const texts = (app: ReturnType<typeof createApp>) => app.activeMessages().map((m) => m.body)

describe("projections", () => {
  test("reactions fold into one chip per emoji, pressed where the human reacted", () => {
    const reactions: WireReaction[] = [
      { by: ada, emoji: "👍" },
      { by: human, emoji: "🔥" },
      { by: bob, emoji: "👍" },
    ]
    expect(reactionChips(reactions)).toEqual([
      { emoji: "👍", count: 2, viewerReacted: false },
      { emoji: "🔥", count: 1, viewerReacted: true },
    ])
    expect(reactionChips([])).toBeUndefined()
  })

  test("tapping the human's own emoji removes it, any other emoji replaces it", () => {
    const reactions: WireReaction[] = [{ by: human, emoji: "🔥" }, { by: ada, emoji: "👍" }]
    expect(nextReaction(reactions, "🔥")).toBeNull()
    expect(nextReaction(reactions, "👍")).toBe("👍")
    expect(nextReaction(undefined, "👍")).toBe("👍")
  })

  test("a protocol message becomes the transcript's view", () => {
    const view = toChatMessage(
      {
        id: "m2" as MessageId,
        seq: 2,
        at: 5,
        from: ada,
        text: "hi",
        rich: fixtures.richText,
        replyTo: "m1" as MessageId,
        editedAt: 6,
        files: [fixtures.file],
      },
      fixtures.roomId,
    )
    expect(view).toMatchObject({ id: "m2", seq: 2, sender: "bot", botId: "ada", body: "hi", sentAt: 5, replyToId: "m1", edited: true })
    expect(view.rich).toBe(fixtures.richText)
    expect(view.media?.[0]).toMatchObject({ kind: "photo", alt: "plan.png" })
    expect(view.documents).toBeUndefined()
    const pending = toChatMessage({ id: "local:c" as MessageId, seq: Number.MAX_SAFE_INTEGER, at: 1, from: human, text: "x", pending: true }, "r")
    expect(pending).toMatchObject({ sender: "user", status: "sending" })
    expect(pending.seq).toBeUndefined()
  })

  test("the first unread message is the oldest one from someone else above the read marker", () => {
    const m = (seq: number, from: typeof human | typeof ada) => ({ id: `m${seq}` as MessageId, seq, at: seq, from, text: "" })
    const list = [m(1, ada), m(2, human), m(3, human), m(4, ada), m(5, ada)]
    expect(firstUnread(list, 1)).toBe("m4" as MessageId)
    expect(firstUnread(list, 5)).toBeNull()
  })
})

describe("useApp over the mock room", () => {
  test("boots from the sockets and draws the fixture room", async () => {
    const { app } = await boot()
    expect(texts(app)).toEqual(["can you two plan the wire protocol package?", "the plan"])
    expect(app.bots().map((b) => b.name)).toEqual(["protocol plan"])
    expect(app.members().map((m) => m.name)).toEqual(["ada", "bob"])
    app.stop()
  })

  test("a send shows at once as sending, then as sent once the room stores it", async () => {
    const { app, room } = await boot()
    const id = app.appendMessage({ body: "ship it" })
    expect(id).toStartWith("local:")
    const last = app.activeMessages().at(-1)!
    expect(last).toMatchObject({ body: "ship it", sender: "user", status: "sending" })
    await until(() => app.activeMessages().at(-1)?.status === "sent")
    expect(room.log.at(-1)).toMatchObject({ t: "message", text: "ship it" })
    expect(texts(app).filter((t) => t === "ship it")).toHaveLength(1)
    app.stop()
  })

  test("a reply carries the quoted message's id to the room", async () => {
    const { app, room } = await boot()
    app.appendReply({ body: "agreed" }, "m2")
    expect(app.activeMessages().at(-1)?.replyToId).toBe("m2")
    await until(() => room.received.some((f) => f.t === "send"))
    expect(room.received.find((f) => f.t === "send")).toMatchObject({ text: "agreed", replyTo: "m2" })
    app.stop()
  })

  test("a reaction applies before the room answers, and a second tap removes it", async () => {
    const { app, room } = await boot()
    const chips = () => app.messageById("m2")?.reactions ?? []
    app.toggleReaction("m2", "🔥")
    expect(chips()).toEqual([{ emoji: "🔥", count: 1, viewerReacted: true }])
    expect(room.received.some((f) => f.t === "react")).toBe(false)
    await until(() => room.log.at(-1)?.t === "react" && app.room()!.state.patches.length === 0)
    expect(chips()).toEqual([{ emoji: "🔥", count: 1, viewerReacted: true }])

    app.toggleReaction("m2", "🔥")
    expect(chips()).toEqual([])
    app.toggleReaction("m2", "👍")
    app.toggleReaction("m2", "🎉")
    // One reaction per actor: the last emoji replaces the one before.
    expect(chips()).toEqual([{ emoji: "🎉", count: 1, viewerReacted: true }])
    app.stop()
  })

  test("typing frames become the members' names", async () => {
    const { app, room } = await boot()
    room.broadcast({ t: "typing", who: [fixtures.ada] })
    await until(() => app.typingNames().length > 0)
    expect(app.typingNames()).toEqual(["ada"])
    expect(app.bots()[0].presence).toBe("typing")
    room.broadcast({ t: "typing", who: [] })
    await until(() => app.typingNames().length === 0)
    app.stop()
  })

  test("the unread divider stays where it was when the room was opened", async () => {
    // The fixture log without its read event: both agent messages are unread.
    const unread = fixtures.roomEvents.filter((e) => e.t !== "read")
    const { app, room } = await boot(unread)
    expect(app.firstUnreadMessageId()).toBe("m2")
    expect(app.hasUnread()).toBe(true)

    app.markRead(fixtures.roomId)
    expect(app.hasUnread()).toBe(false)
    await until(() => room.log.at(-1)?.t === "read")
    expect(app.firstUnreadMessageId()).toBe("m2")

    room.store({ t: "message", id: "m99" as MessageId, from: { kind: "agent", slug: "bob" as AgentSlug }, text: "new" })
    await until(() => texts(app).includes("new"))
    expect(app.firstUnreadMessageId()).toBe("m2")
    app.stop()
  })

  test("a message that arrives while the room is open and read gets no divider", async () => {
    const { app, room } = await boot()
    expect(app.firstUnreadMessageId()).toBeNull()
    room.store({ t: "message", id: "m99" as MessageId, from: ada, text: "fresh" })
    await until(() => texts(app).includes("fresh"))
    expect(app.firstUnreadMessageId()).toBeNull()
    app.stop()
  })

  test("pinning a chat applies at once", async () => {
    const { app, user } = await boot()
    expect(app.bots()[0].pinned).toBe(true)
    app.togglePinned(fixtures.roomId)
    expect(app.bots()[0].pinned).toBe(false)
    await until(() => user.received.some((f) => f.t === "chat"))
    app.stop()
  })

  test("a chat row that did not change keeps its object, so the list keeps its DOM", async () => {
    const { app } = await boot()
    app.createChat("another chat")
    const before = app.bots()
    expect(before.length).toBeGreaterThan(1)
    expect(app.chatById(before[0].id)).toBe(before[0])
    app.togglePinned(fixtures.roomId)
    const after = app.bots()
    const changed = after.find((row) => row.id === fixtures.roomId)!
    expect(changed).not.toBe(before.find((row) => row.id === fixtures.roomId))
    expect(changed.pinned).toBe(false)
    for (const row of after) if (row.id !== fixtures.roomId) expect(row).toBe(before.find((b) => b.id === row.id)!)
    app.stop()
  })

  test("opening another chat closes the first room's socket", async () => {
    const { app, room, other } = await boot()
    expect(room.peers).toBe(1)
    app.selectThread(fixtures.otherRoomId)
    expect(app.activeMessages()).toEqual([])
    await until(() => room.peers === 0 && other.peers === 1)
    app.stop()
  })
})
