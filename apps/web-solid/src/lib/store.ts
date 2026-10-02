import { chatSeed } from "./identity"
// The app's state, backed by the sync stores. Sidebar, transcript, and composer
// all read and write it through `useApp`, so none of them knows about sockets,
// IndexedDB, or wire types.
//
// Boot order, architecture section 19.2:
//
//   1. The shell paints. `main.tsx` calls `useApp.start(userId)` from an effect,
//      so the first frame never waits on this file.
//   2. `start` opens the user's IndexedDB. The user store and the open room
//      paint the chat list and the newest messages from it.
//   3. Each store then connects its socket with `hello {lastSeq}`.
//
// The protocol is the data: `Chat`, `Member`, and `Message` from
// `@kiko/protocol`. The view shapes in `types.ts` are built from them here, by
// the pure functions below, and nowhere else.

import type { Agent, AgentSlug, AgentState, Chat, FileRef, Member, MessageId, Reaction as WireReaction, RoomId } from "@kiko/protocol"
import { batch, createComputed, createRoot, createSignal, untrack } from "solid-js"
import { createPacer } from "../chat/bubble-pacing"
import type { MockRoom } from "../sync/mock-room"
import type { LocalAttachment, ViewMessage } from "../sync/patches"
import { uploadAll } from "../sync/uploads"
import { createRoomStore, type RoomStore, type SendOptions } from "../sync/room-store"
import { browserConnect, type Connect } from "../sync/socket"
import { createUserStore, newRoomId, type UserStore } from "../sync/user-store"
import { createDraftBook, type DraftBook } from "../warm/drafts"
import { openWarm, type Warm, type WarmOptions } from "../warm/db"
import { newestMessages } from "../warm/messages"
import type { BotPresence, ChatMessage, DocumentItem, MediaItem, OutgoingMessage, Reaction, RosterBot } from "./types"

// The URLs. The one place a socket or file URL is built.

function wsOrigin(): string {
  const loc = globalThis.location
  if (!loc) return "ws://localhost"
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}`
}

export const urls = {
  user: () => `${wsOrigin()}/api/ws/user`,
  room: (roomId: RoomId) => `${wsOrigin()}/api/ws/room/${roomId}`,
  // ASSUMPTION: the download route. P8-03 builds it and may change this line.
  file: (roomId: string, fileId: string) => `/api/files/${roomId}/${encodeURIComponent(fileId)}`,
}

/** How the stores reach the server. The browser's `WebSocket` unless a test or the dev mock says otherwise. */
export type Transport = { user: Connect; room: (roomId: RoomId) => Connect }

const liveTransport: Transport = { user: browserConnect, room: () => browserConnect }

// Pure projections, exported for the tests.

const reactionKey = (r: WireReaction) => (r.by.kind === "human" ? "human" : `agent:${r.by.slug}`)

/** Folds one-reaction-per-actor into one chip per emoji, in first-seen order. */
export function reactionChips(reactions: readonly WireReaction[] | undefined): Reaction[] | undefined {
  if (!reactions?.length) return undefined
  const chips: Reaction[] = []
  for (const r of reactions) {
    let chip = chips.find((c) => c.emoji === r.emoji)
    if (!chip) chips.push((chip = { emoji: r.emoji, count: 0, viewerReacted: false }))
    chip.count += 1
    if (r.by.kind === "human") chip.viewerReacted = true
  }
  return chips
}

/**
 * The emoji the human reacts with after tapping `emoji`, or null to remove.
 * The protocol keeps one reaction per actor, so a new emoji replaces the old.
 */
export function nextReaction(reactions: readonly WireReaction[] | undefined, emoji: string): string | null {
  const own = reactions?.find((r) => r.by.kind === "human")
  return own?.emoji === emoji ? null : emoji
}

function signature(m: ViewMessage): string {
  const reactions = (m.reactions ?? []).map((r) => `${reactionKey(r)}=${r.emoji}`).join(",")
  return [m.id, m.seq, m.pending ? 1 : 0, m.text, m.editedAt ?? "", m.replyTo ?? "", m.files?.length ?? 0, reactions].join("|")
}

/** The transcript's view of one protocol message. */
export function toChatMessage(m: ViewMessage, roomId: string): ChatMessage {
  const out: ChatMessage = {
    id: m.id,
    threadId: roomId,
    sender: m.from.kind === "human" ? "user" : "bot",
    body: m.text,
    sentAt: m.at,
  }
  if (m.from.kind === "agent") out.botId = m.from.slug
  if (!m.pending) out.seq = m.seq
  if (m.rich) out.rich = m.rich
  if (m.replyTo) out.replyToId = m.replyTo
  if (m.editedAt !== undefined) out.edited = true
  const chips = reactionChips(m.reactions)
  if (chips) out.reactions = chips
  if (m.files?.length) {
    // Pictures and video with known dimensions are media; everything else is a document row.
    const visual = (f: FileRef) => (f.type.startsWith("image/") || f.type.startsWith("video/")) && !!f.width && !!f.height
    const media = m.files.filter(visual).map(
      (f): MediaItem => ({ kind: f.type.startsWith("video/") ? "video" : "photo", src: urls.file(roomId, f.id), width: f.width!, height: f.height!, alt: f.name }),
    )
    const docs = m.files.filter((f) => !visual(f)).map((f): DocumentItem => ({ name: f.name, size: f.size, mime: f.type, src: urls.file(roomId, f.id) }))
    if (media.length) out.media = media
    if (docs.length) out.documents = docs
  } else if (m.local?.length) {
    const media = m.local.filter((f) => f.width && f.height).map((f): MediaItem => ({ kind: "photo", src: f.src, width: f.width!, height: f.height!, alt: f.name }))
    const docs = m.local.filter((f) => !(f.width && f.height)).map((f): DocumentItem => ({ name: f.name, size: 0, mime: f.mime, src: f.src }))
    if (media.length) out.media = media
    if (docs.length) out.documents = docs
  }
  if (m.from.kind === "human") out.status = m.failed ? "failed" : m.pending ? "sending" : "sent"
  return out
}

/**
 * The first message the human has not read: the oldest one from someone else
 * with a `seq` above `readSeq`. Null when everything is read.
 */
export function firstUnread(messages: readonly ViewMessage[], readSeq: number): MessageId | null {
  for (const m of messages) if (!m.pending && m.from.kind !== "human" && m.seq > readSeq) return m.id
  return null
}

/** The newest stored message's `seq`, or 0. A pending send has none. */
export function newestSeq(messages: readonly ViewMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].pending) return messages[i].seq
  return 0
}

export function presenceOf(typing: boolean, state: AgentState | undefined): BotPresence {
  if (typing) return "typing"
  return state === "working" ? "working" : "idle"
}

export function chatRow(chat: Chat, presence: BotPresence = "idle"): RosterBot {
  return {
    id: chat.roomId,
    name: chat.title,
    preview: chat.lastPreview,
    updatedAt: chat.updatedAt,
    presence,
    unread: chat.unread,
    pinned: chat.pinned,
  }
}

export function memberRow(member: Member, presence: BotPresence = "idle"): RosterBot {
  const row: RosterBot = { id: member.slug, name: member.name, preview: "", updatedAt: 0, presence, unread: 0, pinned: false }
  if (member.lead) row.persona = "lead"
  return row
}

// The store.

export type AppOptions = {
  /** The browser's `WebSocket`, or the dev mock in a dev build with `VITE_KIKO_SYNC=mock`. */
  transport?: () => Promise<Transport>
  /** Passed to `openWarm`, for tests. */
  warm?: Omit<WarmOptions, "userId">
  /** Passed to both stores, for tests. */
  backoff?: { baseMs?: number; maxMs?: number }
}

export type App = ReturnType<typeof createApp>

export function createApp(options: AppOptions = {}) {
  return createRoot(() => {
    const [userStore, setUserStore] = createSignal<UserStore | null>(null)
    const [room, setRoom] = createSignal<RoomStore | null>(null)
    const [drafts, setDrafts] = createSignal<DraftBook | null>(null)
    const [activeId, setActiveId] = createSignal<RoomId | null>(null)

    /** Newest messages of chats the pointer rested on, read from IndexedDB. Only for rooms that are not open. */
    const [preloaded, setPreloaded] = createSignal<Record<string, ViewMessage[]>>({})

    let session: { userId: string; warm: Warm; transport: Transport } | null = null
    let booting: Promise<void> | null = null
    let bootUser: string | null = null

    /** The unread anchor, frozen once per visit so it does not move while the reader looks. */
    const anchors = new WeakMap<RoomStore, MessageId | null>()
    /** Built views by message id, so an unchanged message keeps its object. */
    let views = new Map<string, { sig: string; view: ChatMessage }>()

    /*
     * Bubble pacing (architecture 6.3). A bubble of a live run that arrives faster than a person
     * could type it is held out of the view, not out of the store, so a reload shows all of them.
     * `paced` bumps when a bubble is held or released.
     */
    const LIVE_WINDOW_MS = 30_000
    const [paced, bumpPaced] = createSignal(0)
    let pacer = createPacer({ onChange: () => bumpPaced((n) => n + 1) })
    /** Drafts by `runId:index` and when each was first seen, so a growing bubble keeps its time. */
    const draftSince = new Map<string, number>()
    let pacedRoom: RoomStore | null = null
    let seeded = false

    createComputed(() => {
      const r = room()
      if (!r) return
      const list = r.messages()
      const loaded = r.state.loaded
      untrack(() => {
        if (pacedRoom !== r) {
          pacer.dispose()
          pacer = createPacer({ onChange: () => bumpPaced((n) => n + 1) })
          draftSince.clear()
          pacedRoom = r
          seeded = false
        }
        if (!loaded) return
        if (!seeded) {
          // Whatever the warm tier painted is history.
          seeded = true
          for (const m of list) pacer.offer({ id: m.id, slug: "", chars: 0, live: false })
          return
        }
        const t = Date.now()
        for (const m of list) {
          const live = m.from.kind === "agent" && !!m.run && !m.pending && t - m.at < LIVE_WINDOW_MS
          pacer.offer({ id: m.id, slug: m.from.kind === "agent" ? m.from.slug : "", chars: m.text.length, live })
        }
      })
    })

    /*
     * A new burst restarts a run: the first run ends with no bubble (`idle`), then `typing` comes
     * again. The dots stay up through that gap. An agent that went quiet after posting a bubble
     * is done, and its dots go at once.
     */
    const RESTART_GRACE_MS = 1500
    const [lingering, setLingering] = createSignal<string[]>([])
    const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let wasTyping = new Map<string, number>()
    createComputed(() => {
      const r = room()
      const typing = r ? [...r.state.typing] : []
      const count = (slug: string) => (r ? r.state.messages.filter((m) => m.from.kind === "agent" && m.from.slug === slug).length : 0)
      untrack(() => {
        const nowTyping = new Map<string, number>()
        for (const slug of typing) {
          nowTyping.set(slug, wasTyping.get(slug) ?? count(slug))
          const timer = lingerTimers.get(slug)
          if (timer !== undefined) clearTimeout(timer)
          lingerTimers.delete(slug)
        }
        const stopped = [...wasTyping].filter(([slug]) => !nowTyping.has(slug))
        wasTyping = nowTyping
        const quiet = stopped.filter(([slug, before]) => count(slug) === before).map(([slug]) => slug)
        const drop = (slug: string) => {
          lingerTimers.delete(slug)
          setLingering((l) => l.filter((x) => x !== slug))
        }
        setLingering((l) => [...l.filter((x) => !nowTyping.has(x)), ...quiet.filter((x) => !l.includes(x))])
        for (const slug of quiet) lingerTimers.set(slug, setTimeout(() => drop(slug), RESTART_GRACE_MS))
        if (!r) for (const timer of lingerTimers.values()) clearTimeout(timer)
      })
    })

    function openRoom(roomId: RoomId | null) {
      const current = room()
      if (current?.state.roomId === roomId) return
      current?.close()
      views = new Map()
      if (!session || !roomId) return void setRoom(null)
      setRoom(
        createRoomStore({
          roomId,
          warm: session.warm,
          url: urls.room(roomId),
          connect: session.transport.room(roomId),
          backoff: options.backoff,
        }),
      )
    }

    const chat = (roomId: string | null): Chat | undefined =>
      roomId === null ? undefined : userStore()?.chats().find((c) => c.roomId === roomId)

    /** True once the open room holds everything the chat list says it has. */
    function caughtUp(r: RoomStore): boolean {
      const lastSeq = chat(r.state.roomId)?.lastSeq
      return r.state.loaded && lastSeq !== undefined && r.state.seq >= lastSeq && (lastSeq > 0 || r.state.connection === "open")
    }

    function findView(id: string): ViewMessage | undefined {
      return room()
        ?.messages()
        .find((m) => m.id === id)
    }

    function members(): RosterBot[] {
      const r = room()
      if (!r) return []
      return r.state.members.map((m) => memberRow(m, presenceOf(r.state.typing.includes(m.slug), r.state.status[m.slug])))
    }

    function send(message: OutgoingMessage, replyTo?: string): string | undefined {
      const r = room()
      const local: LocalAttachment[] = [
        ...(message.media ?? []).map((m) => ({ src: m.src, name: m.alt || "photo", mime: "", width: m.width, height: m.height })),
        ...(message.documents ?? []).map((d) => ({ src: d.src, name: d.name, mime: d.mime })),
      ]
      if (!r || (message.body.trim().length === 0 && local.length === 0)) return undefined
      const stored = replyTo !== undefined && !replyTo.startsWith("local:")
      const opts: SendOptions = stored ? { replyTo: replyTo as MessageId } : {}
      // Attachments show at once from their blob URLs and upload in the background (P8-06).
      if (local.length) Object.assign(opts, { local, uploads: uploadAll(r.state.roomId, local) })
      const clientId = r.send(message.body, opts)
      return `local:${clientId}`
    }

    const app = {
      /** Boots the data layer for a signed-in user. Safe to call again. */
      start(userId: string): Promise<void> {
        if (bootUser === userId && booting) return booting
        app.stop()
        bootUser = userId
        booting = (async () => {
          const [warm, transport] = await Promise.all([
            openWarm({ ...options.warm, userId }),
            (options.transport ?? defaultTransport)(),
          ])
          if (bootUser !== userId) return void warm.close()
          session = { userId, warm, transport }
          batch(() => {
            setDrafts(createDraftBook(warm))
            setUserStore(createUserStore({ warm, url: urls.user(), connect: transport.user, backoff: options.backoff }))
            openRoom(activeId())
          })
        })()
        return booting
      },

      /** Closes the sockets and the database. Signing out calls it. */
      stop() {
        bootUser = null
        booting = null
        room()?.close()
        userStore()?.close()
        drafts()?.close()
        session?.warm.close()
        session = null
        views = new Map()
        batch(() => {
          setPreloaded({})
          setRoom(null)
          setUserStore(null)
          setDrafts(null)
        })
      },

      /** Intent: reads a chat's newest messages from IndexedDB into memory. No network. */
      async preloadChat(threadId: string): Promise<void> {
        const current = session
        if (!current || threadId === activeId() || threadId in preloaded()) return
        const rows = await newestMessages(current.warm, threadId as RoomId, 3)
        if (session !== current) return
        setPreloaded((all) => ({ ...all, [threadId]: rows }))
      },
      /** Unsent text, reply targets, and scroll positions for every chat. Null before sign-in. */
      drafts,

      /** The sync stores, for code that needs more than this surface. */
      room,
      user: userStore,

      /** The chat list as sidebar rows. Pinned first, then the most recent. */
      bots(): RosterBot[] {
        const r = room()
        return (userStore()?.chats() ?? []).map((c) => {
          if (!r || r.state.roomId !== c.roomId) return chatRow(c)
          const typing = r.state.typing.length > 0
          const working = Object.values(r.state.status).includes("working")
          const row = chatRow(c, presenceOf(typing, working ? "working" : undefined))
          // The open room is read as soon as the reader marks it, before the server's count catches up.
          if (r.readSeq() >= newestSeq(r.messages())) row.unread = 0
          return row
        })
      },

      chatById(id: string): RosterBot | undefined {
        return app.bots().find((row) => row.id === id)
      },

      /** The open room's agents, for avatars, names, and the `@` menu. */
      members,

      memberById(slug: string | undefined): RosterBot | undefined {
        return slug === undefined ? undefined : members().find((m) => m.id === slug)
      },

      activeThreadId: activeId,

      /** The open room's file index. `name` is the full path. */
      activeFiles(): FileRef[] {
        return room()?.state.files ?? []
      },

      selectThread(threadId: string) {
        const id = threadId as RoomId
        if (activeId() === id) return
        setActiveId(id)
        openRoom(id)
      },

      /** The open room's messages, oldest first, with every pending action applied. */
      activeMessages(): ChatMessage[] {
        const r = room()
        if (!r) return []
        const roomId = r.state.roomId
        const next = new Map<string, { sig: string; view: ChatMessage }>()
        paced()
        const out = r.messages().filter((m) => !pacer.isHeld(m.id)).map((m) => {
          const sig = signature(m)
          const key = m.clientId ?? m.id
          const cached = views.get(key)
          const entry = cached && cached.sig === sig ? cached : { sig, view: toChatMessage(m, roomId) }
          next.set(key, entry)
          return entry.view
        })
        views = next
        // A growing block shows until its final message is on screen. A held final keeps its dots.
        const shown = new Set(out.map((m) => m.id))
        const finals = new Set(r.messages().filter((m) => m.run && shown.has(m.id)).map((m) => `${m.run!.runId}:${m.run!.index}`))
        for (const [key, d] of Object.entries(r.state.drafts)) {
          if (finals.has(key) || d.text === "") continue
          const since = draftSince.get(key) ?? Date.now()
          draftSince.set(key, since)
          out.push({ id: `draft:${key}`, threadId: roomId, sender: "bot", botId: d.slug, body: d.text, sentAt: since })
        }
        return out
      },

      messageById(messageId: string): ChatMessage | undefined {
        const r = room()
        const m = findView(messageId)
        return m && r ? toChatMessage(m, r.state.roomId) : undefined
      },

      /** Hover previews. Only the open room is in memory, so another room has none. */
      messagesFor(threadId: string): ChatMessage[] {
        if (room()?.state.roomId === threadId) return app.activeMessages()
        return (preloaded()[threadId] ?? []).map((m) => toChatMessage(m, threadId))
      },

      /**
       * Where the unread divider goes. It follows the server until the room has
       * caught up or the reader marks it read, then stays put for this visit.
       */
      firstUnreadMessageId(): string | null {
        const r = room()
        if (!r) return null
        if (anchors.has(r)) return anchors.get(r) ?? null
        const live = firstUnread(r.messages(), r.state.readSeq)
        if (caughtUp(r)) anchors.set(r, live)
        return live
      },

      /** The display names of the agents typing in the open room. */
      /** The avatar seed for a chat: its one agent's slug, or the room id for a group. See `lib/identity.ts`. */
      chatSeed(roomId: string): string {
        const chat = userStore()?.chats().find((c) => c.roomId === roomId)
        return chatSeed(chat ?? { roomId }, userStore()?.agents() ?? [])
      },

      /** The slugs of the agents typing now, for the typing bubble's avatar. */
      typingSlugs(): string[] {
        const r = room()
        if (!r) return []
        paced()
        const slugs = new Set<string>([...r.state.typing, ...lingering(), ...pacer.holders()])
        slugs.delete("")
        for (const d of Object.values(r.state.drafts)) slugs.delete(d.slug)
        return [...slugs]
      },

      typingNames(): string[] {
        const r = room()
        if (!r) return []
        // Held bubbles keep the dots up even after the run's `idle`.
        paced()
        const slugs = new Set<string>([...r.state.typing, ...lingering(), ...pacer.holders()])
        slugs.delete("")
        for (const d of Object.values(r.state.drafts)) slugs.delete(d.slug)
        return [...slugs].map((slug) => r.state.members.find((m) => m.slug === slug)?.name ?? slug)
      },

      /** The composer calls this on input. The room store sends at most one frame every 2 s. */
      typing() {
        room()?.typing()
      },

      /** True when the open room has a stored message newer than the read marker and the socket is up. */
      hasUnread(): boolean {
        const r = room()
        return !!r && r.state.connection === "open" && newestSeq(r.messages()) > r.readSeq()
      },

      /** One reaction per actor: the same emoji removes it, another replaces it. */
      toggleReaction(messageId: string, emoji: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || m.pending) return
        r.react(m.id, nextReaction(m.reactions, emoji))
      },

      appendMessage(message: OutgoingMessage, _sentAt?: number): string | undefined {
        return send(message)
      },

      appendReply(message: OutgoingMessage, replyToId: string, _sentAt?: number): string | undefined {
        if (!replyToId || !findView(replyToId)) return undefined
        return send(message, replyToId)
      },

      /** Marks the open room read up to its newest message. Another room has no socket to mark it on. */
      markRead(threadId: string) {
        const r = room()
        if (!r || r.state.roomId !== threadId) return
        if (!anchors.has(r)) anchors.set(r, firstUnread(r.messages(), r.state.readSeq))
        r.markRead(newestSeq(r.messages()))
      },

      /** The user's own agents, in the order they were made. */
      agents(): Agent[] {
        return userStore()?.agents() ?? []
      },

      createAgent(agent: Agent) {
        userStore()?.createAgent(agent)
      },

      /** Starts a chat with `agents` (their ids) and returns its room id. It is in the list before the server hears of it. */
      createChat(title: string, agents?: readonly string[]): RoomId | undefined {
        return userStore()?.createChat(title, agents)
      },

      togglePinned(threadId: string) {
        const user = userStore()
        const c = chat(threadId)
        if (user && c) user.pin(c.roomId, !c.pinned)
      },
    }
    return app
  })
}

// The dev mock. A dev build with `VITE_KIKO_SYNC=mock` talks to the mock
// room and user from `sync/mock-room.ts`, because the room and user sockets on
// the server are not built yet. A production build drops this branch and the
// mock with it.

async function defaultTransport(): Promise<Transport> {
  if (import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock") {
    const [mock, fixtures] = await Promise.all([import("../sync/mock-room"), import("@kiko/protocol/fixtures")])
    return devTransport(mock, fixtures.roomId)
  }
  return liveTransport
}

type MockModule = typeof import("../sync/mock-room")

function devTransport(mock: MockModule, fixtureRoom: RoomId): Transport {
  // `?mockChats=2000` seeds a long list, to prove the sidebar stays virtual. Dev only.
  const count = Number(new URLSearchParams(globalThis.location?.search).get("mockChats")) || 0
  const user = mock.createMockUser(count > 0 ? { chats: manyChats(count) } : {})
  const rooms = new Map<string, MockRoom>()
  return {
    user: user.connect,
    room: (roomId) => {
      let r = rooms.get(roomId)
      if (!r) {
        // The fixture room keeps the shared fixtures. Any other room starts empty.
        // A first connect gets the snapshot, because only the snapshot carries the members.
        r = mock.createMockRoom(roomId === fixtureRoom ? { resetAfter: 0 } : { events: [], resetAfter: 0 })
        rooms.set(roomId, r)
      }
      return answering(r)
    },
  }
}

function manyChats(count: number): Chat[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    roomId: newRoomId(now - i * 1000),
    title: `chat ${i + 1}`,
    pinned: i < 3,
    muted: false,
    lastSeq: 0,
    lastPreview: `message number ${i + 1} in this chat`,
    unread: i % 7 === 0 ? 1 : 0,
    updatedAt: now - i * 60_000,
  }))
}

/** Wraps the mock's socket so the lead agent types and then answers each send. */
function answering(room: MockRoom): Connect {
  return (url) => {
    const socket = room.connect(url)
    const send = socket.send.bind(socket)
    socket.send = (data) => {
      send(data)
      const frame = JSON.parse(data) as { t: string; text?: string }
      if (frame.t !== "send") return
      const lead = (room.snapshot().members.find((m) => m.lead)?.slug ?? "ada") as AgentSlug
      setTimeout(() => room.broadcast({ t: "typing", who: [lead] }), 400)
      setTimeout(() => {
        room.broadcast({ t: "typing", who: [] })
        room.store({ t: "message", id: `a${Date.now()}` as MessageId, from: { kind: "agent", slug: lead }, text: `heard: ${frame.text}` })
      }, 1600)
    }
    return socket
  }
}

export const useApp = createApp()
