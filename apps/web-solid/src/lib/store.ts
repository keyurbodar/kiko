import { chatFaces, chatSeed } from "./identity"
import { onChatModelChange } from "../settings/chat-model"
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

import type { Agent, AgentSlug, AgentState, Chat, FileRef, Member, MemberOp, MemberRefusal, MessageId, Reaction as WireReaction, RoomId, FileOp } from "@kiko/protocol"
import { batch, createComputed, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { isServer } from "solid-js/web"
import { createPacer } from "../chat/bubble-pacing"
import type { MockRoom } from "../sync/mock-room"
import type { LocalAttachment, ViewMessage } from "../sync/patches"
import { attachmentName, uploadAll } from "../sync/uploads"
import { createRoomStore, type MemberNotice, type RoomStore, type SendOptions } from "../sync/room-store"
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
  /** A file's small still, when `FileRef.thumb` says it has one. */
  thumb: (roomId: string, fileId: string) => `/api/files/${roomId}/${encodeURIComponent(fileId)}/thumb`,
}

/**
 * What a small surface (a transcript cell, a grid tile) draws for a file: its still, or the
 * original picture when it has none. Undefined for a clip without a still: draw its thumbhash.
 */
export function stillOf(roomId: string, f: FileRef): string | undefined {
  if (f.thumb) return urls.thumb(roomId, f.id)
  return f.type.startsWith("video/") ? undefined : urls.file(roomId, f.id)
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

/**
 * What decides whether a message's row must be built again. It never copies the text: a stored
 * message's text changes only by an edit, which sets `editedAt`, and a pending send's never does.
 * Every room update (a new bubble, a reaction, a typing change) walks the window with this, so it
 * has to stay cheap.
 */
export function signature(m: ViewMessage): string {
  let reactions = ""
  for (const r of m.reactions ?? []) reactions += `${reactionKey(r)}=${r.emoji},`
  return `${m.id}|${m.seq}|${m.editedAt ?? ""}|${m.pending ? 1 : 0}|${m.failed ? 1 : 0}|${m.replyTo ?? ""}|${m.files?.length ?? 0}|${m.local?.length ?? 0}|${reactions}|${m.goto ?? ""}|${m.quote?.length ?? ""}`
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
  if (m.goto) out.goto = m.goto
  if (m.quote) out.quote = m.quote
  const chips = reactionChips(m.reactions)
  if (chips) out.reactions = chips
  if (m.files?.length) {
    // Pictures and video with known dimensions are media; everything else is a document row.
    const visual = (f: FileRef) => (f.type.startsWith("image/") || f.type.startsWith("video/")) && !!f.width && !!f.height
    const media = m.files.filter(visual).map((f): MediaItem => {
      const item: MediaItem = { kind: f.type.startsWith("video/") ? "video" : "photo", src: urls.file(roomId, f.id), width: f.width!, height: f.height!, alt: attachmentName(f.name) }
      if (f.thumb) item.thumb = urls.thumb(roomId, f.id)
      if (f.thumbhash) item.thumbhash = f.thumbhash
      return item
    })
    const docs = m.files.filter((f) => !visual(f)).map((f): DocumentItem => ({ name: attachmentName(f.name), size: f.size, mime: f.type, src: urls.file(roomId, f.id) }))
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

/**
 * A derived value computed once per change and shared by every reader. Solid's server build,
 * which the tests run on, never updates a memo, so there it is the plain function.
 */
function shared<T>(fn: () => T): () => T {
  return isServer ? fn : createMemo(fn)
}

/** True when two sidebar rows show the same thing. Rows are flat, so a shallow compare is enough. */
export function sameRow(a: RosterBot, b: RosterBot): boolean {
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  for (const k in x) if (x[k] !== y[k]) return false
  for (const k in y) if (!(k in x)) return false
  return true
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
    /*
     * The open room's messages with every pending action applied. Built once per change and
     * shared: the transcript, the chat list's unread count, the unread divider, and the typing
     * dots all read it, and each used to walk the whole room through the store on its own.
     */
    const roomMessages = shared(() => room()?.messages() ?? [])

    /** Newest messages of chats the pointer rested on, read from IndexedDB. Only for rooms that are not open. */
    const [preloaded, setPreloaded] = createSignal<Record<string, ViewMessage[]>>({})

    let session: { userId: string; warm: Warm; transport: Transport } | null = null
    let olderBusy = false
    let olderDone: RoomStore | null = null
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
      const list = roomMessages()
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

    /*
     * The transcript's rows in two parts, so a growing draft never walks the stored window and a
     * stored change never rebuilds the drafts. Each part keeps an unchanged row's object.
     */
    const storedRows = shared(() => {
      const r = room()
      if (!r) return { rows: [] as ChatMessage[], finals: new Set<string>() }
      paced()
      const roomId = r.state.roomId
      const prev = views
      const next = new Map<string, { sig: string; view: ChatMessage }>()
      const finals = new Set<string>()
      const rows: ChatMessage[] = []
      for (const m of roomMessages()) {
        if (pacer.isHeld(m.id)) continue
        const sig = signature(m)
        const key = m.clientId ?? m.id
        const cached = prev.get(key)
        const entry = cached && cached.sig === sig ? cached : { sig, view: toChatMessage(m, roomId) }
        next.set(key, entry)
        rows.push(entry.view)
        // A growing block shows until its final message is on screen.
        if (m.run) finals.add(`${m.run.runId}:${m.run.index}`)
      }
      views = next
      return { rows, finals }
    })
    let draftRowsCache = new Map<string, ChatMessage>()
    const draftRows = shared((): ChatMessage[] => {
      const r = room()
      if (!r) return []
      const roomId = r.state.roomId
      const { finals } = storedRows()
      const next = new Map<string, ChatMessage>()
      const out: ChatMessage[] = []
      for (const [key, d] of Object.entries(r.state.drafts)) {
        if (finals.has(key) || d.text === "") continue
        const since = draftSince.get(key) ?? Date.now()
        draftSince.set(key, since)
        // An unchanged draft keeps its object, so its row is not built again.
        const id = `draft:${key}`
        const cached = draftRowsCache.get(id)
        const view = cached && cached.body === d.text ? cached : { id, threadId: roomId, sender: "bot" as const, botId: d.slug, body: d.text, sentAt: since }
        next.set(id, view)
        out.push(view)
      }
      for (const key of draftSince.keys()) if (!(key in r.state.drafts)) draftSince.delete(key)
      draftRowsCache = next
      return out
    })
    const activeRows = shared(() => {
      const drafts = draftRows()
      const { rows } = storedRows()
      return drafts.length ? [...rows, ...drafts] : rows
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

    /*
     * The chat list as rows, built once per change. A row that did not change keeps its object,
     * so the sidebar, the tabs, and the palette keep their DOM (and the avatars in it) when
     * something else in the list moves.
     */
    let lastRows = new Map<string, RosterBot>()
    const botRows = shared<RosterBot[]>(() => {
      const r = room()
      const next = new Map<string, RosterBot>()
      // A draft with kiko is not in the list until kiko makes it a group (section 7.11).
      const rows = (userStore()?.chats() ?? []).filter((c) => !c.draft).map((c) => {
        let row: RosterBot
        if (!r || r.state.roomId !== c.roomId) row = chatRow(c)
        else {
          const typing = r.state.typing.length > 0
          const working = Object.values(r.state.status).includes("working")
          row = chatRow(c, presenceOf(typing, working ? "working" : undefined))
          // The open room is read as soon as the reader marks it, before the server's count catches up.
          if (r.readSeq() >= newestSeq(roomMessages())) row.unread = 0
        }
        const old = lastRows.get(row.id)
        if (old && sameRow(old, row)) row = old
        next.set(row.id, row)
        return row
      })
      lastRows = next
      return rows
    })
    const botIndex = shared(() => new Map(botRows().map((row) => [row.id, row])))

    function findView(id: string): ViewMessage | undefined {
      return roomMessages().find((m) => m.id === id)
    }

    function members(): RosterBot[] {
      const r = room()
      if (!r) return []
      return r.members().map((m) => memberRow(m, presenceOf(r.state.typing.includes(m.slug), r.state.status[m.slug])))
    }

    function send(message: OutgoingMessage, replyTo?: string, quote?: string): string | undefined {
      const r = room()
      const local: LocalAttachment[] = [
        ...(message.media ?? []).map((m) => ({ src: m.src, name: m.alt || "photo", mime: "", width: m.width, height: m.height })),
        ...(message.documents ?? []).map((d) => ({ src: d.src, name: d.name, mime: d.mime })),
      ]
      if (!r || (message.body.trim().length === 0 && local.length === 0)) return undefined
      const stored = replyTo !== undefined && !replyTo.startsWith("local:")
      const opts: SendOptions = stored ? { replyTo: replyTo as MessageId, ...(quote ? { quote } : {}) } : {}
      // Attachments show at once from their blob URLs and upload in the background (P8-06).
      if (local.length) Object.assign(opts, { local, uploads: uploadAll(r.state.roomId, local) })
      const clientId = r.send(message.body, opts)
      return `local:${clientId}`
    }

    // A model picked for a chat goes to that chat's agents on the server, when it is the open one.
    onChatModelChange((chatId, ref) => {
      const r = room()
      if (r && r.state.roomId === chatId) r.model(ref)
    })

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
        return botRows()
      },

      chatById(id: string): RosterBot | undefined {
        return botIndex().get(id)
      },

      /** The open room's agents, for avatars, names, and the `@` menu. */
      members,

      memberById(slug: string | undefined): RosterBot | undefined {
        return slug === undefined ? undefined : members().find((m) => m.id === slug)
      },

      activeThreadId: activeId,

      /** The open room's file index. `name` is the full path. */
      activeFiles(): FileRef[] {
        return room()?.files() ?? []
      },

      /** The open room's folders, empty ones included. */
      activeFolders(): string[] {
        return room()?.folders() ?? []
      },

      /** The user's drive, /home (architecture section 18.3): the same in every chat. */
      homeFiles(): FileRef[] {
        return userStore()?.homeFiles() ?? []
      },

      homeFolders(): string[] {
        return userStore()?.homeFolders() ?? []
      },

      homeOp(op: FileOp): void {
        userStore()?.homeOp(op)
      },

      onHomeRefused(listener: (op: FileOp, reason: string) => void): () => void {
        return userStore()?.onHomeRefused(listener) ?? (() => {})
      },

      /** `rm`, `mv`, or `mkdir` on the open room's files, shown at once. */
      fileOp(op: FileOp): void {
        room()?.fileOp(op)
      },

      onFilesRefused(listener: (op: FileOp, reason: string) => void): () => void {
        return room()?.onFilesRefused(listener) ?? (() => {})
      },

      selectThread(threadId: string) {
        const id = threadId as RoomId
        if (activeId() === id) return
        setActiveId(id)
        openRoom(id)
      },

      /** The open room's messages, oldest first, with every pending action applied. Shared by every reader. */
      activeMessages(): ChatMessage[] {
        return activeRows()
      },

      /**
       * Pages older messages of the open room in from IndexedDB, once at a time. Stops asking once
       * the disk has nothing older, until the room changes.
       */
      loadOlder(): void {
        const r = room()
        if (!r || olderBusy || olderDone === r) return
        olderBusy = true
        void r.loadOlder().then(
          (n) => {
            olderBusy = false
            if (n === 0) olderDone = r
          },
          () => (olderBusy = false),
        )
      },

      /** The reader is at the newest message: the open room goes back to holding only its newest window. */
      followLatest(): void {
        room()?.follow()
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
        const live = firstUnread(roomMessages(), r.state.readSeq)
        if (caughtUp(r)) anchors.set(r, live)
        return live
      },

      /** The display names of the agents typing in the open room. */
      /** The avatar seed for a chat: its one agent's slug, or the room id for a group. See `lib/identity.ts`. */
      chatSeed(roomId: string): string {
        const chat = userStore()?.chats().find((c) => c.roomId === roomId)
        return chatSeed(chat ?? { roomId }, userStore()?.agents() ?? [])
      },

      /**
       * The faces of a chat's avatar: one for a chat with one agent, up to three for a group.
       * The open room's live members win over the agents the chat was made with.
       */
      chatFaces(roomId: string): string[] {
        const chat = userStore()?.chats().find((c) => c.roomId === roomId)
        const r = room()
        const live = r && r.state.roomId === roomId ? r.members().map((m) => m.slug) : undefined
        return chatFaces(chat ?? { roomId }, userStore()?.agents() ?? [], live)
      },

      /** The open room's agents as the protocol has them: role, model, and lead included. */
      roomMembers(): Member[] {
        return room()?.members() ?? []
      },

      /** Adds, renames, or removes an agent in the open room. It applies at once; a refusal rolls it back. */
      memberOp(op: MemberOp) {
        room()?.member(op)
      },

      /** Calls `listener` when the open room refuses a member change. Returns the unsubscribe. */
      onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void {
        return room()?.onMemberRefused(listener) ?? (() => {})
      },

      /** Who joined and left the open room, for the transcript's system lines. */
      memberNotices(): MemberNotice[] {
        return room()?.state.roster ?? []
      },

      /** What the first typing agent is doing now, such as "editing /hello.html", or undefined. */
      typingDoing(): string | undefined {
        const slug = this.typingSlugs()[0]
        return slug ? room()?.state.doing[slug] : undefined
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
        return !!r && r.state.connection === "open" && newestSeq(roomMessages()) > r.readSeq()
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

      appendReply(message: OutgoingMessage, replyToId: string, quote?: string): string | undefined {
        if (!replyToId || !findView(replyToId)) return undefined
        return send(message, replyToId, quote)
      },

      /** Marks the open room read up to its newest message. Another room has no socket to mark it on. */
      markRead(threadId: string) {
        const r = room()
        if (!r || r.state.roomId !== threadId) return
        if (!anchors.has(r)) anchors.set(r, firstUnread(roomMessages(), r.state.readSeq))
        r.markRead(newestSeq(roomMessages()))
      },

      /** The user's own agents, in the order they were made. */
      agents(): Agent[] {
        return userStore()?.agents() ?? []
      },

      createAgent(agent: Agent) {
        userStore()?.createAgent(agent)
      },

      /** Starts a chat with `agents` (their ids) and returns its room id. It is in the list before the server hears of it. */
      /** A draft with kiko: "ask" or "group". Returns its room id. */
      createDraft(kind: "ask" | "group"): RoomId | undefined {
        return userStore()?.createDraft(kind)
      },

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
