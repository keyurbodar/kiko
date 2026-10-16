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

import type { Agent, AgentSlug, AgentState, Chat, ChatLast, FileRef, Member, MemberOp, MemberRefusal, MessageId, Reaction as WireReaction, RoomId, FileOp } from "@kiko/protocol"
import { fileName, humanHandle, mentionsHuman, messageLast } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { showRunError } from "./run-error"
import { session as signedIn } from "../app/session"
import { describeLast, typingLine } from "../sidebar/activity"
import { batch, createComputed, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { isServer } from "solid-js/web"
import { createPacer } from "../chat/bubble-pacing"
import type { MockRoom } from "../sync/mock-room"
import type { LocalAttachment, ViewMessage } from "../sync/patches"
import { createRoomStore, type MemberNotice, type RoomStore, type SearchPage, type SendOptions } from "../sync/room-store"
import { socketUrl } from "./api"
import { fileToken, fileUrl } from "./file-token"
import { browserConnect, type Connect } from "../sync/socket"
import { createUserStore, newRoomId, type UserStore } from "../sync/user-store"
import { createDraftBook, type DraftBook } from "../warm/drafts"
import { openWarm, type Warm, type WarmOptions } from "../warm/db"
import { newestMessages } from "../warm/messages"
import type { BotPresence, ChatMessage, OutgoingMessage, Reaction, RosterBot } from "./types"
import { resumeChat, rosterChats } from "./chats"
import { dmFor } from "@kiko/protocol"

// The URLs. The one place a socket or file URL is built.

export const urls = {
  user: () => socketUrl("/api/ws/user"),
  room: (roomId: RoomId) => socketUrl(`/api/ws/room/${roomId}`),
  file: (roomId: string, fileId: string) => fileUrl(`/api/files/${roomId}/${encodeURIComponent(fileId)}`),
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
  if (m.event) out.event = m.event
  if (m.goto) out.goto = m.goto
  if (m.quote) out.quote = m.quote
  if (m.to) out.to = m.to
  if (m.initiative) out.initiative = m.initiative.reason
  const chips = reactionChips(m.reactions)
  if (chips) out.reactions = chips
  // A stored file keeps only what today's bubble reads, so an old message's media fields fall away here.
  if (m.files?.length) out.files = m.files.map((f) => ({ name: fileName(f.name), path: f.name, size: f.size, type: f.type, src: urls.file(roomId, f.id) }))
  else if (m.local?.length) out.files = m.local.map((f) => ({ name: f.name, size: f.size, type: f.type, src: f.src }))
  if (m.from.kind === "human") out.status = m.failed ? "failed" : m.pending ? "sending" : "sent"
  return out
}

/**
 * The first message the human has not read: the oldest one from someone else
 * with a `seq` above `readSeq`. Null when everything is read.
 */
export function firstUnread(messages: readonly ViewMessage[], readSeq: number): MessageId | null {
  for (const m of messages) if (!m.pending && !m.event && m.from.kind !== "human" && m.seq > readSeq) return m.id
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

/** What the open room knows before the server's row does: its newest message, who is typing, its size. */
export type LiveRow = { last?: ChatLast; typing?: readonly string[]; group?: boolean }

/**
 * A chat as a sidebar row. The second line is the newest activity in words (`sidebar/activity.ts`);
 * a row stored before the server sent `last` shows its plain `lastPreview`.
 */
export function chatRow(chat: Chat, presence: BotPresence = "idle", live: LiveRow = {}): RosterBot {
  const group = live.group ?? !!chat.group
  const last = live.last ?? chat.last
  const line = last ? describeLast(last, group) : { text: chat.lastPreview }
  const typing = live.typing ?? []
  const row: RosterBot = {
    id: chat.roomId,
    name: chat.title,
    preview: line.text,
    updatedAt: Math.max(chat.updatedAt, live.last?.at ?? 0),
    presence: typing.length ? "typing" : presence,
    unread: chat.unread,
    pinned: chat.pinned,
  }
  if (last) row.lastFrom = last.from
  if (line.from) row.previewFrom = line.from
  if (row.presence === "typing") row.typing = typingLine(typing, group)
  if (chat.mentions) row.mentions = chat.mentions
  return row
}

/** The activity a view message is, for the open room's row before the server's touch. */
export function viewLast(m: ViewMessage, name: (slug: string) => string): ChatLast {
  const files = m.files ?? m.local
  return messageLast({ from: m.from.kind, ...(m.from.kind === "agent" ? { name: name(m.from.slug) } : {}), text: m.text, ...(files ? { files } : {}), at: m.at })
}

/**
 * The open room's messages that mention the human, oldest first: an agent's `@handle` or reply to
 * a human message (`mentionsHuman`). A handle an agent of the room also holds counts as none.
 */
export function mentionIds(messages: readonly ViewMessage[], handle: string | null, slugs: readonly string[]): { id: MessageId; seq: number }[] {
  const own = handle && !slugs.includes(handle) ? handle : null
  const human = new Set(messages.filter((m) => m.from.kind === "human").map((m) => m.id))
  return messages
    .filter((m) => !m.pending && m.from.kind === "agent" && mentionsHuman(m.text, own, !!m.replyTo && human.has(m.replyTo)))
    .map((m) => ({ id: m.id, seq: m.seq }))
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

/** How many chats' hover previews stay in memory. */
export const MAX_PRELOADED = 20

/** The last `max` keys of `record`, in insertion order. */
export function keepNewest<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record
  return Object.fromEntries(keys.slice(-max).map((k) => [k, record[k]]))
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

    /**
     * Newest messages of chats the pointer rested on, read from IndexedDB. Only for rooms that are
     * not open, and only the `MAX_PRELOADED` most recent, so hovering down a long list holds little.
     */
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

    const activeRows = shared(() => {
      const r = room()
      if (!r) return [] as ChatMessage[]
      paced()
      const roomId = r.state.roomId
      const prev = views
      const next = new Map<string, { sig: string; view: ChatMessage }>()
      const rows: ChatMessage[] = []
      for (const m of roomMessages()) {
        if (pacer.isHeld(m.id)) continue
        const sig = signature(m) + (m.files?.length ? fileToken() : "")
        const key = m.clientId ?? m.id
        const cached = prev.get(key)
        const entry = cached && cached.sig === sig ? cached : { sig, view: toChatMessage(m, roomId) }
        next.set(key, entry)
        rows.push(entry.view)
      }
      views = next
      return rows
    })

    function openRoom(roomId: RoomId | null) {
      const current = room()
      if (current?.state.roomId === roomId) return
      current?.close()
      views = new Map()
      setUnseen([])
      if (!session || !roomId) return void setRoom(null)
      const next = createRoomStore({
        roomId,
        warm: session.warm,
        url: urls.room(roomId),
        connect: session.transport.room(roomId),
        backoff: options.backoff,
      })
      // A send the room refused stays in the transcript, marked failed. The toast says why.
      next.onTaskRefused((reason) => showToastV2({ title: reason, variant: "error" }))
      next.onSendRefused((reason) => showToastV2({ title: reason, variant: "error" }))
      next.onRunError((frame) => showRunError(frame, next.state.members.find((m) => m.slug === frame.slug)?.name ?? "The agent"))
      setRoom(next)
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
      // Every chat, hidden ones too: the tab strip names them. `roster` is what the sidebar lists.
      const typingIn = userStore()?.state.typing ?? {}
      const rows = (userStore()?.chats() ?? []).map((c) => {
        let row: RosterBot
        if (!r || r.state.roomId !== c.roomId) row = chatRow(c, "idle", { typing: typingIn[c.roomId] })
        else {
          const working = Object.values(r.state.status).includes("working")
          const members = r.members()
          const name = (slug: string) => members.find((m) => m.slug === slug)?.name ?? slug
          // The open room's own messages are the newest truth: a send shows in its row before the server's touch.
          const newest = roomMessages().at(-1)
          const fresh = newest && (newest.pending || newest.seq > c.lastSeq) ? viewLast(newest, name) : undefined
          row = chatRow(c, presenceOf(false, working ? "working" : undefined), {
            ...(fresh ? { last: fresh } : {}),
            typing: r.state.typing.map(name),
            ...(members.length ? { group: members.length > 1 } : {}),
          })
          // The open room is read as soon as the reader marks it, before the server's count catches up.
          if (r.readSeq() >= newestSeq(roomMessages())) {
            row.unread = 0
            delete row.mentions
          }
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
    const roster = shared<RosterBot[]>(() => {
      const index = botIndex()
      return rosterChats(userStore()?.chats() ?? []).flatMap((c) => index.get(c.roomId) ?? [])
    })

    /*
     * The chat the user was last in (architecture section 7.11). This device keeps its own copy in
     * localStorage, read at once on boot; the server keeps one for a new device.
     */
    const lastKey = () => (session ? `kiko.last-chat:${session.userId}` : null)
    const [localLast, setLocalLast] = createSignal<string | null>(null)
    function readLast(): string | null {
      const key = lastKey()
      try {
        return key ? localStorage.getItem(key) : null
      } catch {
        return null
      }
    }
    function remember(id: RoomId) {
      setLocalLast(id)
      const key = lastKey()
      try {
        if (key) localStorage.setItem(key, id)
      } catch {
        // Blocked storage keeps the server's copy only.
      }
      userStore()?.open(id)
    }
    // A chat opened before sign-in finished booting is remembered once the user store is there.
    createComputed(() => {
      const id = activeId()
      if (id && userStore()) untrack(() => remember(id))
    })

    /*
     * Mentions of the human in the open room (Telegram's @ button). Reading the room marks every
     * message read at once, so a mention the reader has not seen yet is tracked here: `markRead`
     * adds each mention it reads past, and the transcript removes one when it is on screen or
     * jumped to. Memory only, per visit.
     */
    const handle = () => {
      const s = signedIn()
      return s.status === "signed-in" ? humanHandle(s.user.name) : null
    }
    const roomMentions = shared(() => {
      const r = room()
      return r ? mentionIds(roomMessages(), handle(), r.members().map((m) => m.slug)) : []
    })
    const [unseen, setUnseen] = createSignal<readonly MessageId[]>([])

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
      const local: LocalAttachment[] = (message.files ?? []).map((f) => ({ src: f.src, name: f.name, type: f.type, size: f.size }))
      if (!r || (message.body.trim().length === 0 && local.length === 0)) return undefined
      const stored = replyTo !== undefined && !replyTo.startsWith("local:")
      const opts: SendOptions = stored ? { replyTo: replyTo as MessageId, ...(quote ? { quote } : {}) } : {}
      // Each attachment uploaded when it was picked: the room claims it by id, and the message shows
      // it from its blob URL until the room's copy arrives.
      if (message.attachments?.length) Object.assign(opts, { attachments: message.attachments, local })
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
            setLocalLast(readLast())
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
        setPreloaded((all) => keepNewest({ ...all, [threadId]: rows }, MAX_PRELOADED))
      },
      /** Unsent text, reply targets, and scroll positions for every chat. Null before sign-in. */
      drafts,

      /** The sync stores, for code that needs more than this surface. */
      room,
      user: userStore,

      /** The chat list as sidebar rows: the kiko chat, then pinned, then the most recent. No temporary or hidden chats. */
      bots(): RosterBot[] {
        return roster()
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

      /** The chat to open when the URL names none: the last one the user was in, else the kiko chat. Null until known. */
      resumeChat(): RoomId | null {
        const user = userStore()
        if (!user) return null
        return resumeChat(user.chats(), user.state.loaded && (user.state.synced || user.state.chats.length > 0), [localLast(), user.state.lastChat])
      },

      /** The user's kiko chat, or undefined before the list has it. */
      kikoChatId(): RoomId | undefined {
        return userStore()?.chats().find((c) => c.kiko)?.roomId
      },

      /** The chat with this room id as the protocol has it, temporary ones included. */
      chat,

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

      /**
       * The reader is at the end of what is shown: the open room goes back to holding only its newest
       * window, or, in a window it jumped to, pages newer messages in.
       */
      followLatest(): void {
        room()?.follow()
      },

      /** Searches the open room's messages, newest first. Null when the room does not answer. */
      searchRoom(query: string, before?: number): Promise<SearchPage | null> {
        return room()?.search(query, before) ?? Promise.resolve(null)
      },

      /**
       * Makes the open room's message at `seq` part of the transcript, loading a window around it from
       * the room when it is not held. Resolves to false when there is no such message.
       */
      async jumpTo(seq: number): Promise<boolean> {
        const r = room()
        if (!r) return false
        await r.ready
        const found = await r.jumpTo(seq)
        // The window may start anywhere now, so scrolling up may page again.
        if (found && olderDone === r) olderDone = null
        return found
      },

      /** True while the transcript shows a window the reader jumped to, not the live end. */
      showingHistory(): boolean {
        return !!room()?.state.history
      },

      /** Leaves a jumped-to window for the live end. */
      goLive(): void {
        room()?.live()
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

      /**
       * What each typing agent is doing now, in `typingSlugs` order, such as "editing /hello.html".
       * A run that is working without saying on what is using a tool.
       */
      typingDoings(): (string | undefined)[] {
        const r = room()
        return this.typingSlugs().map((slug) => r?.state.doing[slug] ?? (r?.state.status[slug as never] === "working" ? "using a tool" : undefined))
      },

      /** The slugs of the agents typing now, for the typing bubble's avatar. */
      typingSlugs(): string[] {
        const r = room()
        if (!r) return []
        paced()
        const slugs = new Set<string>([...r.state.typing, ...lingering(), ...pacer.holders()])
        slugs.delete("")
        return [...slugs]
      },

      typingNames(): string[] {
        const r = room()
        if (!r) return []
        // Held bubbles keep the dots up even after the run's `idle`.
        paced()
        const slugs = new Set<string>([...r.state.typing, ...lingering(), ...pacer.holders()])
        slugs.delete("")
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

      /** Replaces the text of one of the human's own stored messages. Applies at once. */
      editMessage(messageId: string, text: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || m.pending || m.from.kind !== "human" || text.trim() === "" || text === m.text) return
        r.edit(m.id, text)
      },

      /** Deletes one of the human's own stored messages. Applies at once. */
      deleteMessage(messageId: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || m.pending || m.from.kind !== "human") return
        r.remove(m.id)
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
        const read = r.readSeq()
        const fresh = roomMentions().filter((m) => m.seq > read && !unseen().includes(m.id))
        if (fresh.length) setUnseen((list) => [...list, ...fresh.map((m) => m.id)])
        r.markRead(newestSeq(roomMessages()))
      },

      /** The open room's mentions of the human the reader has not seen yet, oldest first. */
      unseenMentions(): readonly MessageId[] {
        const live = new Set(roomMentions().map((m) => m.id))
        return unseen().filter((id) => live.has(id))
      },

      /** The reader saw these mentions: on screen, or jumped to. */
      seeMentions(ids: readonly string[]) {
        if (ids.length) setUnseen((list) => list.filter((id) => !ids.includes(id)))
      },

      /** The user's own agents, in the order they were made. */
      agents(): Agent[] {
        return userStore()?.agents() ?? []
      },

      createAgent(agent: Agent) {
        userStore()?.createAgent(agent)
      },

      /**
       * The agent's one direct chat (architecture section 7.11), made only when it has none. Every
       * way of picking an agent comes here. A new one is in the list before the server hears of it.
       */
      openDm(agent: Agent): RoomId | undefined {
        const user = userStore()
        if (!user) return undefined
        return dmFor(user.chats(), agent.id)?.roomId ?? user.createChat(agent.name, [agent.id])
      },

      /** The kiko chat stays pinned. */
      togglePinned(threadId: string) {
        const user = userStore()
        const c = chat(threadId)
        if (user && c && !c.kiko) user.pin(c.roomId, !c.pinned)
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
    title: `Chat ${i + 1}`,
    pinned: i < 3,
    muted: false,
    lastSeq: 0,
    lastPreview: `Message number ${i + 1} in this chat`,
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
