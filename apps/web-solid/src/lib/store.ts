import { chatFaces, chatSeed } from "./identity"
// The app's state, backed by the sync stores. Sidebar, transcript, and composer
// all read and write it through `useApp`, so none of them knows about sockets,
// IndexedDB, or wire types.
//
// Boot order:
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

import type { Agent, AgentModel, AgentSlug, ThinkingLevel, AgentState, Chat, ChatLast, FileRef, Member, MemberOp, MemberRefusal, MessageId, Reaction as WireReaction, RoomId, FileOp, RunStep } from "@kiko/protocol"
import { fileName, KIKO, humanHandle, mentionsHuman, messageLast } from "@kiko/protocol"
import { isListed } from "../sidebar/activity"
import { agentDisplayName } from "./names"
import { seenInChat, showFailure, showKikoError } from "./errors"
import { session as signedIn } from "../app/session"
import { describeLast, typingLine } from "../sidebar/activity"
import { batch, createComputed, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { isServer } from "solid-js/web"
import { createPacer } from "../chat/bubble-pacing"
import { inWindow, newestAfter, parseWindow, stepWindows, windowKey } from "../chat/run/run-log"
import type { MockRoom } from "../sync/mock-room"
import type { LocalAttachment, ViewMessage } from "../sync/patches"
import { createRoomStore, NO_MORE, type RoomSeed, type RoomStore, type SearchPage, type SendOptions } from "../sync/room-store"
import { socketUrl } from "./api"
import { fileToken, fileUrl } from "./file-token"
import { browserConnect, type Connect } from "../sync/socket"
import { createUserStore, newRoomId, type UserStore } from "../sync/user-store"
import { createDraftBook, type DraftBook } from "../warm/drafts"
import { openWarm, type Warm, type WarmOptions } from "../warm/db"
import { newestMessages } from "../warm/messages"
import type { BotPresence, ChatMessage, OutgoingMessage, Reaction, RosterBot } from "./types"
import { distinctTitles, resumeChat, rosterChats } from "./chats"

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
  return `${m.id}|${m.seq}|${m.editedAt ?? ""}|${m.pending ? 1 : 0}|${m.failed ? 1 : 0}|${m.replyTo ?? ""}|${m.reply?.gone ? 1 : 0}|${m.files?.length ?? 0}|${m.local?.length ?? 0}|${reactions}|${m.goto ?? ""}|${m.quote?.length ?? ""}|${m.steps ?? 0}|${m.stepAfter ?? 0}`
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
  if (m.reply) out.reply = m.reply
  if (m.editedAt !== undefined) out.edited = true
  if (m.event) out.event = m.event
  if (m.goto) out.goto = m.goto
  if (m.quote) out.quote = m.quote
  if (m.to) out.to = m.to
  if (m.initiative) out.initiative = m.initiative.reason
  if (m.steps) {
    out.steps = m.steps
    out.stepAfter = m.stepAfter ?? 0
  }
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
  return messageLast({ from: m.from.kind, ...(m.from.kind === "agent" ? { name: name(m.from.slug) } : {}), text: m.text, ...(m.rich ? { rich: m.rich, mentionName: name } : {}), ...(files ? { files } : {}), at: m.at })
}

/**
 * The open room's messages that mention the human, oldest first: an agent's `@handle` or reply to
 * a human message (`mentionsHuman`). A handle an agent of the room also holds counts as none, and so
 * does a message to another agent: the transcript folds it into a divider, so it is never on screen.
 */
export function mentionIds(messages: readonly ViewMessage[], handle: string | null, slugs: readonly string[]): { id: MessageId; seq: number }[] {
  const own = handle && !slugs.includes(handle) ? handle : null
  const human = new Set(messages.filter((m) => m.from.kind === "human").map((m) => m.id))
  return messages
    .filter((m) => !m.pending && m.from.kind === "agent" && m.to === undefined && mentionsHuman(m.text, own, !!m.replyTo && human.has(m.replyTo)))
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

    /**
     * Recent rooms' windows, kept so going back to a chat paints from memory instead of
     * waiting on IndexedDB. Each entry is a complete paint: the socket replays everything after
     * `seq`, so a cached window can never be older than the replay that follows it.
     */
    const roomCache = new Map<string, RoomSeed>()
    const MAX_ROOM_CACHE = 32

    function keepRoom(r: RoomStore): void {
      const s = r.state
      roomCache.delete(s.roomId)
      roomCache.set(s.roomId, {
        messages: [...s.messages],
        seq: s.seq,
        readSeq: s.readSeq,
        members: [...s.members],
        tasks: [...s.tasks],
        files: [...s.files],
        folders: [...s.folders],
        asks: [...s.asks],
      })
      while (roomCache.size > MAX_ROOM_CACHE) {
        const oldest = roomCache.keys().next().value
        if (oldest === undefined) break
        roomCache.delete(oldest)
      }
    }

    /** The unread anchor, frozen once per visit so it does not move while the reader looks. */
    const anchors = new WeakMap<RoomStore, MessageId | null>()
    /** A room the human answered: its divider is gone for this visit and never frozen again. */
    const answered = new WeakSet<RoomStore>()
    /** Bumped when an anchor changes, so the transcript rebuilds without waiting for the next room event. */
    const [anchorEpoch, bumpAnchor] = createSignal(0)
    /** The read marker the room had when its stored state painted, before the socket and any read. */
    const openRead = new WeakMap<RoomStore, number>()
    /** The marker this device last read up to, per room: leaving and returning must not re-arm the divider. */
    const localRead = new Map<RoomId, number>()
    /** Built views by message id, so an unchanged message keeps its object. */
    let views = new Map<string, { sig: string; view: ChatMessage }>()

    /*
     * Bubble pacing. A bubble of a live run that arrives faster than a person
     * could type it is held out of the view, not out of the store, so a reload shows all of them.
     * `paced` bumps when a bubble is held or released.
     */
    const LIVE_WINDOW_MS = 30_000
    const [paced, bumpPaced] = createSignal(0)
    let pacer = createPacer({ onChange: () => bumpPaced((n) => n + 1) })
    let pacedRoom: RoomStore | null = null
    let seeded = false
    // The typing dots that outlive a run's `idle`, and the message count each agent had when it stopped.
    const RESTART_GRACE_MS = 1500
    const [lingering, setLingering] = createSignal<string[]>([])
    const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let wasTyping = new Map<string, number>()

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
          // Presence belongs to the room that reported it. Comparing one room's message counts against
          // the next room's would invent a "quiet" agent and leave its typing dots up for a second.
          wasTyping = new Map()
          for (const timer of lingerTimers.values()) clearTimeout(timer)
          lingerTimers.clear()
          setLingering([])
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

    /** The step window each agent message in view opens, for the run panel. */
    const windows = shared(() => stepWindows(activeRows()))

    function openRoom(roomId: RoomId | null) {
      const current = room()
      if (current?.state.roomId === roomId) return
      // Leaving a chat drops its divider: the next visit works out a fresh one from the new marker.
      if (current) {
        anchors.delete(current)
        if (current.state.loaded) keepRoom(current)
      }
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
        onError: showKikoError,
        ...(roomCache.has(roomId) ? { seed: roomCache.get(roomId) } : {}),
      })
      // A send the room refused stays in the transcript, marked failed. The toast says why.
      next.onTaskRefused(showFailure)
      next.onSendRefused(showFailure)
      setRoom(next)
    }

    const chat = (roomId: string | null): Chat | undefined =>
      roomId === null ? undefined : userStore()?.chats().find((c) => c.roomId === roomId)

    /** True once the open room holds everything the chat list says it has. */
    function caughtUp(r: RoomStore): boolean {
      const lastSeq = chat(r.state.roomId)?.lastSeq
      return r.state.booted && lastSeq !== undefined && r.state.seq >= lastSeq && (lastSeq > 0 || r.state.connection === "open")
    }

    /**
     * Fixes the unread divider's place, once per visit, to the first message the reader had not
     * read when the chat opened. It waits for the room to catch up, because before that the
     * transcript has no trustworthy beginning. The marker is the one the stored state painted
     * with, so a read the reader makes now cannot move it. A message that lands after this never
     * moves it either: the reader is at the bottom of the open chat, so nothing arrives unseen.
     */
    function freezeAnchor(): void {
      const r = room()
      if (!r || anchors.has(r) || answered.has(r) || !caughtUp(r)) return
      const read = Math.max(openRead.get(r) ?? r.state.readSeq, localRead.get(r.state.roomId) ?? 0)
      anchors.set(r, firstUnread(roomMessages(), read))
    }

    // The stored state paints once, before the socket opens. That marker is what the chat opened with.
    createComputed(() => {
      const r = room()
      if (!r) return
      const booted = r.state.booted
      const read = r.state.readSeq
      untrack(() => {
        if (booted && !openRead.has(r)) openRead.set(r, read)
      })
    })

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
      const rows = distinctTitles(userStore()?.chats() ?? []).map((c) => {
        let row: RosterBot
        if (!r || r.state.roomId !== c.roomId) row = chatRow(c, "idle", { typing: typingIn[c.roomId] })
        else {
          const working = Object.values(r.state.status).includes("working")
          const members = r.members()
          const name = (slug: string) => agentDisplayName(slug, members)
          // The open room's own messages are the newest truth: a send shows in its row before the server's touch.
          const newest = roomMessages().findLast(isListed)
          const fresh = newest && (newest.pending || newest.seq > c.lastSeq) ? viewLast(newest, name) : undefined
          row = chatRow(c, presenceOf(false, working ? "working" : undefined), {
            ...(fresh ? { last: fresh } : {}),
            typing: Object.entries(r.state.status).filter(([, state]) => state === "typing").map(([slug]) => name(slug)),
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
     * The chat the user was last in. This device keeps its own copy in
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
     * Mentions of the human in the open room (the @ button). Reading the room marks every
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
      return r.members().map((m) => memberRow(m, presenceOf(r.state.status[m.slug] === "typing", r.state.status[m.slug])))
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
      // The divider goes the moment the human answers: the anchor is cleared before the next read, so
      // the transcript rebuild the send just caused already sees it gone.
      anchors.set(r, null)
      answered.add(r)
      bumpAnchor((n) => n + 1)
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
            setLocalLast(readLast())
            setDrafts(createDraftBook(warm))
            setUserStore(createUserStore({ warm, url: urls.user(), connect: transport.user, backoff: options.backoff, onError: (error, roomId) => seenInChat(roomId, activeId(), document.visibilityState === "visible") || showKikoError(error) }))
            openRoom(activeId())
          })
        })()
        return booting
      },

      /** Closes the sockets and the database. Signing out calls it. */
      stop() {
        bootUser = null
        booting = null
        roomCache.clear()
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

      /** The user's drive, /home: the same in every chat. */
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
            // `NO_MORE` means the room answered and has nothing older. A miss (the socket was down, or
            // the window moved) must not latch, or paging up dies for the rest of the visit.
            if (n === NO_MORE) olderDone = r
          },
          () => (olderBusy = false),
        )
      },

      /**
       * The reader is at the end of what is shown: the open room goes back to holding only its newest
       * window, or, in a window it jumped to, pages newer messages in.
       */
      followLatest(): void {
        const r = room()
        if (!r) return
        r.follow()
        // Following the end trims the window back to its newest rows. The ones it drops are still on
        // disk, so paging up must be allowed to fetch them again.
        if (olderDone === r) olderDone = null
      },

      /**
       * The reader scrolled up: the window holds rows they can still see, so it must not cut its
       * oldest rows on the next message. A chat longer than the window used to lose the text above
       * the reader mid-read.
       */
      holdWindow(): void {
        room()?.hold()
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

      /** True while the transcript shows a window the reader jumped to, not the live end. */      showingHistory(): boolean {
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
       * Where the unread divider goes: the first message the reader had not read when this chat
       * opened, frozen for the visit. Null when everything was read at open, when the human has
       * since sent a message, or when the human has left the chat.
       */
      firstUnreadMessageId(): string | null {
        const r = room()
        if (!r) return null
        anchorEpoch()
        freezeAnchor()
        const id = anchors.get(r)
        if (!id) return null
        const held = roomMessages()
        if (held.some((m) => m.id === id)) return id
        // The window moved past the anchor (a jump, or a long chat trimming its oldest rows). The
        // oldest unread message still shown is the same fact, in the same place.
        const read = Math.max(openRead.get(r) ?? r.state.readSeq, localRead.get(r.state.roomId) ?? 0)
        return firstUnread(held, read)
      },

      /** The display names of the agents typing in the open room. */
      /** The avatar seed for a chat: its one agent's slug, or the room id for a group. See `lib/identity.ts`. */
      chatSeed(roomId: string): string {
        const chat = userStore()?.chats().find((c) => c.roomId === roomId)
        return chatSeed(chat ?? { roomId }, userStore()?.agents() ?? [])
      },

      /**
       * The faces of a chat's avatar: one for a chat with one agent, up to three for a group.
       * Always read from the chat record, open or not, so a tile and the open chat agree.
       */
      chatFaces(roomId: string): string[] {
        const chat = userStore()?.chats().find((c) => c.roomId === roomId)
        return chatFaces(chat ?? { roomId }, userStore()?.agents() ?? [])
      },

      /** The open room's agents as the protocol has them: role and lead included. */
      roomMembers(): Member[] {
        return room()?.members() ?? []
      },

      /** True once the owner's agent models have loaded, from disk or the server. Before that, a missing model means nothing. */
      modelsSynced(): boolean {
        const user = userStore()
        return !!user && user.state.loaded && (user.state.synced || Object.keys(user.state.agentModels).length > 0)
      },

      /** An agent's model and reasoning level. It is the same in every chat. */
      agentModel(slug: string): AgentModel | undefined {
        return userStore()?.agentModel(slug)
      },

      /** Sets an agent's model, its level, or both, for every chat. It applies at once; the server confirms it. */
      setAgentModel(slug: AgentSlug, pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[] }) {
        userStore()?.setAgentModel(slug, { ...pick, ...(room() ? { roomId: room()!.state.roomId } : {}) })
      },

      /** Kiko first, then every agent the owner made. Each one has a model to set. */
      modelAgents(): { slug: AgentSlug; name: string }[] {
        const mine = (userStore()?.agents() ?? []).map((a) => ({ slug: a.slug, name: a.name }))
        return [{ slug: KIKO as AgentSlug, name: "Kiko" }, ...mine.filter((a) => a.slug !== KIKO)]
      },

      /** Adds, renames, or removes an agent in the open room. It applies at once; a refusal rolls it back. */
      memberOp(op: MemberOp) {
        room()?.member(op)
      },

      /** Calls `listener` when the open room refuses a member change. Returns the unsubscribe. */
      onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void {
        return room()?.onMemberRefused(listener) ?? (() => {})
      },

      /**
       * What each typing agent is doing now, in `typingSlugs` order, such as "editing /hello.html".
       * A run that is working without saying on what is using a tool.
       */
      typingDoings(): (string | undefined)[] {
        const r = room()
        return this.typingSlugs().map((slug) => r?.state.doing[slug] ?? (r?.state.status[slug as never] === "working" ? "using a tool" : undefined))
      },

      /** The window of steps this bubble opens in the run panel, or undefined when it opens none. */
      runChevron(m: ChatMessage): string | undefined {
        return m.botId && m.steps ? windowKey(m.botId, m.stepAfter ?? 0) : undefined
      },

      /** The window an agent's typing row opens: the steps no message in view opens yet, once there are some. */
      typingRun(slug: string): string | undefined {
        const r = room()
        if (!r?.state.live[slug]) return undefined
        const after = newestAfter(r.state.steps[slug] ?? [])
        return after >= 0 && !windows().has(windowKey(slug, after)) ? windowKey(slug, after) : undefined
      },

      /** The steps of a window this client holds, in start order. */
      runSteps(key: string): readonly RunStep[] {
        const { slug, after } = parseWindow(key)
        return inWindow(room()?.state.steps[slug] ?? [], after)
      },

      /** True while the agent is mid-run and no message in view opens the window yet. */
      runLive(key: string): boolean {
        return !windows().has(key) && !!room()?.state.live[parseWindow(key).slug]
      },

      /** Asks the room for a bubble's steps when this client holds fewer than the bubble says it opens. */
      loadRunSteps(key: string) {
        const r = room()
        const w = windows().get(key)
        if (r && w && inWindow(r.state.steps[w.slug] ?? [], w.after).length < w.steps) r.requestSteps(w.slug, w.after)
      },

      /** True while a window's steps are on their way. */
      runFetching(key: string): boolean {
        return !!room()?.state.fetching[key]
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
        return [...slugs].map((slug) => agentDisplayName(slug, r.state.members))
      },

      /** The composer calls this on input. The room store sends at most one frame every 2 s. */
      typing() {
        room()?.typing()
      },

      /** True when the open room has a stored message newer than the read marker and the socket is up. */
      hasUnread(): boolean {
        const r = room()
        if (!r) return false
        const read = Math.max(r.readSeq(), localRead.get(r.state.roomId) ?? 0)
        return r.state.connection === "open" && newestSeq(roomMessages()) > read
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

      /** Runs again the input of a failed run, from its error line. The human message is not sent again. */
      retryRun(messageId: string) {
        room()?.retry(messageId as MessageId)
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
        return send(message, replyToId, quote)
      },

      /** Marks the open room read up to its newest message. Another room has no socket to mark it on. */
      markRead(threadId: string) {
        const r = room()
        if (!r || r.state.roomId !== threadId) return
        // The divider is frozen already, from the marker the chat opened with. Reading now does not move it.
        const read = Math.max(r.readSeq(), localRead.get(r.state.roomId) ?? 0)
        const fresh = roomMentions().filter((m) => m.seq > read && !unseen().includes(m.id))
        if (fresh.length) setUnseen((list) => [...list, ...fresh.map((m) => m.id)])
        const newest = newestSeq(roomMessages())
        // This device remembers the mark, so a chat left and reopened does not arm a divider it already cleared.
        if (newest > (localRead.get(r.state.roomId) ?? 0)) localRead.set(r.state.roomId, newest)
        r.markRead(newest)
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
  // Dev only: the rooms are reachable from the console, so a check can send steps by hand.
  ;(globalThis as { __mockRooms?: unknown }).__mockRooms = rooms
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
