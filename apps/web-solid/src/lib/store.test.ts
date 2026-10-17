import { describe, expect, test } from "bun:test"
import type { AgentSlug, MessageId, Reaction as WireReaction, RoomEvent } from "@kiko/protocol"
import * as fixtures from "@kiko/protocol/fixtures"
import { createMockRoom, createMockUser } from "../sync/mock-room"
import { createApp, firstUnread, keepNewest, nextReaction, reactionChips, signature, toChatMessage } from "./store"

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
  await until(() => app.user()?.state.synced === true)
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
    expect(view.files).toEqual([{ name: "plan.png", path: "plan.png", size: 48_211, type: "image/png", src: `/api/files/${fixtures.roomId}/f1` }])
    const pending = toChatMessage({ id: "local:c" as MessageId, seq: Number.MAX_SAFE_INTEGER, at: 1, from: human, text: "x", pending: true, local: [{ src: "blob:a", name: "a.pdf", type: "application/pdf", size: 9 }] }, "r")
    expect(pending.files).toEqual([{ name: "a.pdf", size: 9, type: "application/pdf", src: "blob:a" }])
    expect(pending).toMatchObject({ sender: "user", status: "sending" })
    expect(pending.seq).toBeUndefined()
  })

  test("a bubble keeps its run and its step count, and a new step count rebuilds its row", () => {
    const base = { id: "m4" as MessageId, seq: 4, at: 1, from: ada, text: "done", run: { runId: "run1", attempt: 0, index: 0 } }
    expect(toChatMessage({ ...base, steps: 3 }, fixtures.roomId)).toMatchObject({ runId: "run1", steps: 3 })
    expect(toChatMessage(base, fixtures.roomId).steps).toBeUndefined()
    expect(signature({ ...base, steps: 3 })).not.toBe(signature({ ...base, steps: 4 }))
    expect(signature(base)).not.toBe(signature({ ...base, run: { runId: "run2", attempt: 0, index: 0 } }))
  })

  test("a message stored with the old media fields draws as plain attachments", () => {
    const old = {
      id: "m3" as MessageId,
      seq: 3,
      at: 1,
      from: human,
      text: "",
      files: [{ id: "f9", name: "attachments/k3-photo.png", size: 5, type: "image/png", width: 4, height: 3, thumbhash: "x", thumb: true }],
      preview: { url: "https://a.dev", title: "a" },
    } as unknown as Parameters<typeof toChatMessage>[0]
    const view = toChatMessage(old, "r")
    expect(view.files).toEqual([{ name: "photo.png", path: "attachments/k3-photo.png", size: 5, type: "image/png", src: "/api/files/r/f9" }])
  })

  test("the first unread message is the oldest one from someone else above the read marker", () => {
    const m = (seq: number, from: typeof human | typeof ada) => ({ id: `m${seq}` as MessageId, seq, at: seq, from, text: "" })
    const list = [m(1, ada), m(2, human), m(3, human), m(4, ada), m(5, ada)]
    expect(firstUnread(list, 1)).toBe("m4" as MessageId)
    expect(firstUnread(list, 5)).toBeNull()
  })
})

describe("row signatures and caps", () => {
  const base = { id: "m1" as MessageId, seq: 4, at: 1, from: ada, text: "x".repeat(20_000) }

  test("a signature never copies the text, and changes with what the row draws", () => {
    const sig = signature(base)
    expect(sig.length).toBeLessThan(80)
    expect(signature({ ...base })).toBe(sig)
    expect(signature({ ...base, editedAt: 9 })).not.toBe(sig)
    expect(signature({ ...base, reactions: [{ by: human, emoji: "👍" }] })).not.toBe(sig)
    expect(signature({ ...base, pending: true })).not.toBe(sig)
    expect(signature({ ...base, failed: true })).not.toBe(sig)
    expect(signature({ ...base, seq: 5 })).not.toBe(sig)
  })

  test("hover previews keep only the newest chats", () => {
    const all: Record<string, number> = {}
    for (let i = 0; i < 30; i++) Object.assign(all, keepNewest({ ...all, [`r${i}`]: i }, 20))
    const kept = keepNewest(all, 20)
    expect(Object.keys(kept)).toHaveLength(20)
    expect(Object.keys(kept)[0]).toBe("r10")
  })
})

describe("useApp over the mock room", () => {
  test("a room update rebuilds only the rows it touched", async () => {
    const { app, room } = await boot()
    const before = app.activeMessages()
    room.store({ t: "message", id: "new1" as MessageId, from: ada, text: "a new bubble" })
    await until(() => app.activeMessages().length === before.length + 1)
    const after = app.activeMessages()
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i])
    const target = before.findLast((m) => m.seq !== undefined)!
    room.store({ t: "react", messageId: target.id as MessageId, by: { kind: "agent", slug: fixtures.bob }, emoji: "🔥" })
    await until(() => app.activeMessages().find((m) => m.id === target.id) !== target)
    for (const m of app.activeMessages()) if (m.id !== target.id) expect(after.includes(m)).toBe(true)
    // A growing draft shows no text: its agent stays typing until the whole bubble lands.
    const stored = app.activeMessages()
    room.broadcast({ t: "typing", who: [fixtures.ada] })
    room.broadcast({ t: "draft", slug: fixtures.ada, runId: "r1", index: 0, text: "grow" })
    await until(() => app.typingSlugs().includes(fixtures.ada))
    await sleep(30)
    const typed = app.activeMessages()
    expect(typed).toHaveLength(stored.length)
    for (let i = 0; i < stored.length; i++) expect(typed[i]).toBe(stored[i])
    expect(app.typingSlugs()).toEqual([fixtures.ada])
    app.stop()
  })

  test("boots from the sockets and draws the fixture room", async () => {
    const { app } = await boot()
    expect(texts(app)).toEqual(fixtures.roomSnapshot.messages.map((m) => m.text))
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
    room.broadcast({ t: "status", slug: fixtures.ada, state: "working", doing: "reading /plan.md" })
    await until(() => app.typingDoings()[0] === "reading /plan.md")
    expect(app.bots()[0].presence).not.toBe("typing")
    room.broadcast({ t: "status", slug: fixtures.ada, state: "typing" })
    await until(() => app.bots()[0].presence === "typing")
    room.broadcast({ t: "typing", who: [] })
    room.broadcast({ t: "status", slug: fixtures.ada, state: "idle" })
    await until(() => app.typingNames().length === 0)
    expect(app.bots()[0].presence).not.toBe("typing")
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

  test("sending a message clears the unread divider and it stays gone", async () => {
    const unread = fixtures.roomEvents.filter((e) => e.t !== "read")
    const { app, room } = await boot(unread)
    expect(app.firstUnreadMessageId()).toBe("m2")
    app.appendMessage({ body: "got it" } as never)
    expect(app.firstUnreadMessageId()).toBeNull()
    room.store({ t: "message", id: "m98" as MessageId, from: { kind: "agent", slug: "bob" as AgentSlug }, text: "later" })
    await until(() => texts(app).includes("later"))
    expect(app.firstUnreadMessageId()).toBeNull()
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
    app.user()!.createChat("cy", ["cy"])
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
