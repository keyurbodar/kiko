import { chatFaces } from "./identity"

import type {
  Agent,
  AgentModel,
  AgentSlug,
  RowKind,
  UserRows,
  ThinkingLevel,
  AgentState,
  Chat,
  ChatLast,
  FileRef,
  Member,
  MemberOp,
  MemberRefusal,
  MessageId,
  Reaction as WireReaction,
  RoomId,
  FileOp,
  RunStep,
} from "@kiko/protocol"
import { fileName, isRoomId, KIKO, humanHandle, mentionsHuman, messageLast } from "@kiko/protocol"
import { isListed } from "../sidebar/activity"
import { clearUnreadMark } from "../sidebar/unread-mark"
import { agentDisplayName } from "./names"
import { seenInChat, showFailure, showKikoError } from "./errors"
import { session as signedIn } from "../app/session"
import { describeLast, typingLine } from "../sidebar/activity"
import { batch, createComputed, createMemo, createRoot, createSignal, untrack } from "solid-js"
import { isServer } from "solid-js/web"
import { createPacer } from "../chat/bubble-pacing"
import { inWindow, newestAfter, parseWindow, stepWindows, windowKey } from "../chat/run/run-log"
import type { LocalAttachment, ViewMessage } from "../sync/patches"
import {
  createRoomStore,
  NO_MORE,
  type RoomSeed,
  type RoomStore,
  type SearchPage,
  type SendOptions,
} from "../sync/room-store"
import { socketUrl } from "./api"
import { fileUrl } from "./file-token"
import { browserConnect, type SocketStatus, userChannel } from "../sync/socket"
import { createUserStore, type UserStore } from "../sync/user-store"
import { createDraftBook, type DraftBook } from "../warm/drafts"
import { openWarm, type Warm } from "../warm/db"
import { newestMessages } from "../warm/messages"
import type { BotPresence, ChatMessage, OutgoingMessage, Reaction, RosterBot } from "./types"
import { distinctTitles, resumeChat, rosterChats } from "./chats"

export const urls = {
  owner: () => socketUrl("/api/ws"),
  file: (roomId: string, fileId: string) => fileUrl(`/api/files/${roomId}/${encodeURIComponent(fileId)}`),
}

const reactionKey = (r: WireReaction) => (r.by.kind === "human" ? "human" : `agent:${r.by.slug}`)

function reactionChips(reactions: readonly WireReaction[] | undefined): Reaction[] | undefined {
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

function nextReaction(reactions: readonly WireReaction[] | undefined, emoji: string): string | null {
  const own = reactions?.find((r) => r.by.kind === "human")
  return own?.emoji === emoji ? null : emoji
}

function signature(m: ViewMessage): string {
  let reactions = ""
  for (const r of m.reactions ?? []) reactions += `${reactionKey(r)}=${r.emoji},`
  return `${m.id}|${m.seq}|${m.at}|${m.text?.length ?? 0}|${m.editedAt ?? ""}|${m.pending ? 1 : 0}|${m.failed ? 1 : 0}|${m.replyTo ?? ""}|${m.reply?.gone ? 1 : 0}|${m.reply?.text ?? ""}|${m.files?.length ?? 0}|${m.local?.length ?? 0}|${reactions}|${m.goto ?? ""}|${m.quote ?? ""}|${m.to ?? ""}|${m.event ? 1 : 0}|${m.steps ?? 0}|${m.stepAfter ?? 0}`
}

function toChatMessage(m: ViewMessage, roomId: string): ChatMessage {
  const out: ChatMessage = {
    id: m.id,
    threadId: roomId,
    sender: m.from.kind === "human" ? "user" : "bot",
    body: m.text,
    sentAt: Number.isFinite(m.at) ? m.at : Date.now(),
  }
  if (m.from.kind === "agent") out.botId = m.from.slug
  if (m.clientId) out.clientId = m.clientId
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
  if (m.files?.length)
    out.files = m.files.map((f) => ({
      name: fileName(f.name),
      path: f.name,
      size: f.size,
      type: f.type,
      src: urls.file(roomId, f.id),
    }))
  else if (m.local?.length) out.files = m.local.map((f) => ({ name: f.name, size: f.size, type: f.type, src: f.src }))
  if (m.from.kind === "human") out.status = m.failed ? "failed" : m.pending ? "sending" : "sent"
  return out
}

function firstUnread(messages: readonly ViewMessage[], readSeq: number): MessageId | null {
  for (const m of messages) if (!m.pending && !m.event && m.from.kind !== "human" && m.seq > readSeq) return m.id
  return null
}

function newestSeq(messages: readonly ViewMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].pending) return messages[i].seq
  return 0
}

function presenceOf(typing: boolean, state: AgentState | undefined): BotPresence {
  if (typing) return "typing"
  return state === "working" ? "working" : "idle"
}

export type LiveRow = { last?: ChatLast; typing?: readonly string[]; group?: boolean }

function chatRow(chat: Chat, presence: BotPresence = "idle", live: LiveRow = {}): RosterBot {
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

function viewLast(m: ViewMessage, name: (slug: string) => string): ChatLast {
  const files = m.files ?? m.local
  return messageLast({
    from: m.from.kind,
    ...(m.from.kind === "agent" ? { name: name(m.from.slug) } : {}),
    text: m.text,
    ...(m.rich ? { rich: m.rich, mentionName: name } : {}),
    ...(files ? { files } : {}),
    at: m.at,
  })
}

function mentionIds(
  messages: readonly ViewMessage[],
  handle: string | null,
  slugs: readonly string[],
): { id: MessageId; seq: number }[] {
  const own = handle && !slugs.includes(handle) ? handle : null
  const human = new Set(messages.filter((m) => m.from.kind === "human").map((m) => m.id))
  return messages
    .filter(
      (m) =>
        !m.pending &&
        m.from.kind === "agent" &&
        m.to === undefined &&
        mentionsHuman(m.text, own, !!m.replyTo && human.has(m.replyTo)),
    )
    .map((m) => ({ id: m.id, seq: m.seq }))
}

function shared<T>(fn: () => T): () => T {
  return isServer ? fn : createMemo(fn)
}

function releaseFrontier<T extends { id: MessageId; seq: number; from: { kind: string } }>(
  messages: readonly T[],
  held: ReadonlySet<string>,
): (m: T) => boolean {
  let frontier = Infinity
  for (const m of messages) if (held.has(m.id) && m.seq < frontier) frontier = m.seq
  return (m) => !held.has(m.id) && !(m.seq > frontier && m.from.kind !== "human")
}

function sameRow(a: RosterBot, b: RosterBot): boolean {
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  for (const k in x) if (x[k] !== y[k]) return false
  for (const k in y) if (!(k in x)) return false
  return true
}

function memberRow(member: Member, presence: BotPresence = "idle"): RosterBot {
  const row: RosterBot = {
    id: member.slug,
    name: member.name,
    preview: "",
    updatedAt: 0,
    presence,
    unread: 0,
    pinned: false,
  }
  if (member.lead) row.persona = "lead"
  return row
}

const MAX_PRELOADED = 20

function keepNewest<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record
  return Object.fromEntries(keys.slice(-max).map((k) => [k, record[k]]))
}

export type App = ReturnType<typeof createApp>

function createApp() {
  return createRoot(() => {
    const [userStore, setUserStore] = createSignal<UserStore | null>(null)
    const [room, setRoom] = createSignal<RoomStore | null>(null)
    const [drafts, setDrafts] = createSignal<DraftBook | null>(null)
    const [activeId, setActiveId] = createSignal<RoomId | null>(null)
    const roomMessages = shared(() => room()?.messages() ?? [])

    const [preloaded, setPreloaded] = createSignal<Record<string, ViewMessage[]>>({})
    const preloadedAt: Record<string, number> = {}

    function forgetPreload(roomId: string): void {
      delete preloadedAt[roomId]
      if (!(roomId in preloaded())) return
      setPreloaded((all) => {
        const { [roomId]: _gone, ...rest } = all
        return rest
      })
    }

    const channel = userChannel

    let session: { userId: string; warm: Warm } | null = null
    let olderBusy = false
    let olderDone: RoomStore | null = null
    let booting: Promise<void> | null = null
    let bootUser: string | null = null

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

    const anchors = new WeakMap<RoomStore, MessageId | null>()
    const answered = new WeakSet<RoomStore>()
    const [anchorEpoch, bumpAnchor] = createSignal(0)
    const openRead = new WeakMap<RoomStore, number>()
    const localRead = new Map<RoomId, number>()
    let views = new Map<string, { sig: string; view: ChatMessage }>()

    const LIVE_WINDOW_MS = 30_000
    const [paced, bumpPaced] = createSignal(0)
    let pacer = createPacer({ onChange: () => bumpPaced((n) => n + 1) })
    let pacedRoom: RoomStore | null = null
    let seeded = false
    let openedUnder: SocketStatus | undefined
    const RESTART_GRACE_MS = 1500
    const [lingering, setLingering] = createSignal<string[]>([])
    const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let wasTyping = new Map<string, number>()

    function seedPacer(list: ReturnType<typeof roomMessages>): void {
      for (const m of list) pacer.offer({ id: m.id, slug: "", chars: 0, live: false })
    }

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
          wasTyping = new Map()
          for (const timer of lingerTimers.values()) clearTimeout(timer)
          lingerTimers.clear()
          setLingering([])
        }
        if (!loaded) return
        const connection = r.state.connection
        if (!seeded || connection !== openedUnder) {
          seeded = true
          openedUnder = connection
          seedPacer(list)
          return
        }
        const t = Date.now()
        for (const m of list) {
          const live = m.from.kind === "agent" && !!m.run && !m.pending && t - m.at < LIVE_WINDOW_MS
          pacer.offer({ id: m.id, slug: m.from.kind === "agent" ? m.from.slug : "", chars: m.text?.length ?? 0, live })
        }
      })
    })

    createComputed(() => {
      const r = room()
      const typing = r ? [...r.state.typing] : []
      const count = (slug: string) =>
        r ? r.state.messages.filter((m) => m.from.kind === "agent" && m.from.slug === slug).length : 0
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
        for (const slug of quiet)
          lingerTimers.set(
            slug,
            setTimeout(() => drop(slug), RESTART_GRACE_MS),
          )
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
      const list = roomMessages()
      const release = releaseFrontier(list, new Set(list.filter((m) => pacer.isHeld(m.id)).map((m) => m.id)))
      for (const m of list) {
        if (!release(m)) continue
        const sig = signature(m)
        const key = m.clientId ?? m.id
        const cached = prev.get(key)
        const entry = cached && cached.sig === sig ? cached : { sig, view: toChatMessage(m, roomId) }
        next.set(key, entry)
        rows.push(entry.view)
      }
      views = next
      return rows
    })

    const windows = shared(() => stepWindows(activeRows()))

    function typingOf(r: RoomStore | null): string[] {
      if (!r) return []
      paced()
      const known = new Set(r.state.members.map((m) => m.slug as string))
      const slugs = new Set<string>([...r.state.typing, ...lingering(), ...pacer.holders()])
      slugs.delete("")
      return [...slugs].filter((slug) => known.has(slug))
    }

    const [unseen, setUnseen] = createSignal<readonly MessageId[]>([])
    function openRoom(roomId: RoomId | null) {
      const current = room()
      if (current?.state.roomId === roomId) return
      if (current) {
        anchors.delete(current)
        if (current.state.loaded) keepRoom(current)
        forgetPreload(current.state.roomId)
      }
      current?.close()
      views = new Map()
      setUnseen([])
      if (!session || !roomId) return void setRoom(null)
      forgetPreload(roomId)
      const next = createRoomStore({
        roomId,
        warm: session.warm,
        channel,
        onError: showKikoError,
        ...(roomCache.has(roomId) ? { seed: roomCache.get(roomId) } : {}),
      })
      next.onTaskRefused(showFailure)
      next.onSendRefused(showFailure)
      setRoom(next)
    }

    const chat = (roomId: string | null): Chat | undefined =>
      roomId === null
        ? undefined
        : userStore()
            ?.chats()
            .find((c) => c.roomId === roomId)

    function caughtUp(r: RoomStore): boolean {
      const lastSeq = chat(r.state.roomId)?.lastSeq
      return (
        r.state.booted &&
        lastSeq !== undefined &&
        r.state.seq >= lastSeq &&
        (lastSeq > 0 || r.state.connection === "open")
      )
    }

    function freezeAnchor(): void {
      const r = room()
      if (!r || anchors.has(r) || answered.has(r) || !caughtUp(r)) return
      const read = Math.max(openRead.get(r) ?? r.state.readSeq, localRead.get(r.state.roomId) ?? 0)
      anchors.set(r, firstUnread(roomMessages(), read))
    }

    createComputed(() => {
      const r = room()
      if (!r) return
      const booted = r.state.booted
      const read = r.state.readSeq
      untrack(() => {
        if (booted && !openRead.has(r)) openRead.set(r, read)
      })
    })

    let lastRows = new Map<string, RosterBot>()
    const botRows = shared<RosterBot[]>(() => {
      const r = room()
      const next = new Map<string, RosterBot>()
      const typingIn = userStore()?.state.typing ?? {}
      const rows = distinctTitles(userStore()?.chats() ?? []).map((c) => {
        let row = roomRow(c)
        const old = lastRows.get(row.id)
        if (old && sameRow(old, row)) row = old
        next.set(row.id, row)
        return row
      })
      function roomRow(c: Parameters<typeof chatRow>[0]): RosterBot {
        let row: RosterBot
        if (!r || r.state.roomId !== c.roomId) return chatRow(c, "idle", { typing: typingIn[c.roomId] })
        const working = Object.values(r.state.status).includes("working")
        const members = r.members()
        const name = (slug: string) => agentDisplayName(slug, members)
        const newest = roomMessages().findLast(isListed)
        const fresh = newest && (newest.pending || newest.seq > c.lastSeq) ? viewLast(newest, name) : undefined
        row = chatRow(c, presenceOf(false, working ? "working" : undefined), {
          ...(fresh ? { last: fresh } : {}),
          typing: Object.entries(r.state.status)
            .filter(([, state]) => state === "typing")
            .map(([slug]) => name(slug)),
          ...(members.length ? { group: members.length > 1 } : {}),
        })
        if (!r.state.history && r.readSeq() >= newestSeq(roomMessages())) {
          row.unread = 0
          delete row.mentions
        }
        return row
      }
      lastRows = next
      return rows
    })
    const botIndex = shared(() => new Map(botRows().map((row) => [row.id, row])))
    const roster = shared<RosterBot[]>(() => {
      const index = botIndex()
      return rosterChats(userStore()?.chats() ?? []).flatMap((c) => index.get(c.roomId) ?? [])
    })

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
      } catch {}
      userStore()?.open(id)
    }
    createComputed(() => {
      const id = activeId()
      if (id && userStore()) untrack(() => remember(id))
    })

    const handle = () => {
      const s = signedIn()
      return s.status === "signed-in" ? humanHandle(s.user.name) : null
    }
    const roomMentions = shared(() => {
      const r = room()
      return r
        ? mentionIds(
            roomMessages(),
            handle(),
            r.members().map((m) => m.slug),
          )
        : []
    })

    function findView(id: string): ViewMessage | undefined {
      return roomMessages().find((m) => m.id === id)
    }

    function liveMembers(r: RoomStore): Member[] {
      const gone = userStore()?.state.gone
      return gone ? r.members().filter((m) => !gone[m.slug]) : r.members()
    }

    function members(): RosterBot[] {
      const r = room()
      if (!r) return []
      return liveMembers(r).map((m) =>
        memberRow(m, presenceOf(r.state.status[m.slug] === "typing", r.state.status[m.slug])),
      )
    }

    function send(message: OutgoingMessage, replyTo?: string, quote?: string): string | undefined {
      const r = room()
      const local: LocalAttachment[] = (message.files ?? []).map((f) => ({
        src: f.src,
        name: f.name,
        type: f.type,
        size: f.size,
      }))
      if (!r || (message.body.trim().length === 0 && local.length === 0)) return undefined
      const stored = replyTo !== undefined && !replyTo.startsWith("local:")
      const opts: SendOptions = stored ? { replyTo: replyTo as MessageId, ...(quote ? { quote } : {}) } : {}
      if (message.attachments?.length) Object.assign(opts, { attachments: message.attachments, local })
      const clientId = r.send(message.body, opts)
      anchors.set(r, null)
      answered.add(r)
      bumpAnchor((n) => n + 1)
      return `local:${clientId}`
    }

    const app = {
      start(userId: string): Promise<void> {
        if (bootUser === userId && booting) return booting
        app.stop()
        bootUser = userId
        booting = (async () => {
          const warm = await openWarm({ userId })
          if (bootUser !== userId) return void warm.close()
          session = { userId, warm }
          batch(() => {
            setLocalLast(readLast())
            setDrafts(createDraftBook(warm))
            setUserStore(
              createUserStore({
                warm,
                url: urls.owner(),
                connect: browserConnect,
                channel,
                onError: (error, roomId) =>
                  seenInChat(roomId, activeId(), document.visibilityState === "visible") || showKikoError(error),
              }),
            )
            openRoom(activeId())
          })
        })()
        return booting
      },

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
        for (const key of Object.keys(preloadedAt)) delete preloadedAt[key]
        lastRows = new Map()
        olderDone = null
        seeded = false
        wasTyping = new Map()
        localRead.clear()
        batch(() => {
          setPreloaded({})
          setRoom(null)
          setUserStore(null)
          setDrafts(null)
          setActiveId(null)
          setLocalLast(null)
        })
      },

      async preloadChat(threadId: string): Promise<void> {
        const current = session
        if (!current || threadId === activeId()) return
        const seen = chat(threadId)?.lastSeq ?? 0
        if (preloadedAt[threadId] === seen) return
        const rows = await newestMessages(current.warm, threadId as RoomId, 3)
        if (session !== current || threadId === activeId()) return
        preloadedAt[threadId] = seen
        setPreloaded((all) => keepNewest({ ...all, [threadId]: rows }, MAX_PRELOADED))
      },
      drafts,

      room,
      user: userStore,

      bots(): RosterBot[] {
        return roster()
      },

      chatById(id: string): RosterBot | undefined {
        return botIndex().get(id)
      },

      members,

      memberById(slug: string | undefined): RosterBot | undefined {
        return slug === undefined ? undefined : members().find((m) => m.id === slug)
      },

      activeThreadId: activeId,

      activeFiles(): FileRef[] {
        return room()?.files() ?? []
      },

      activeFolders(): string[] {
        return room()?.folders() ?? []
      },

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

      fileOp(op: FileOp): void {
        room()?.fileOp(op)
      },

      onFilesRefused(listener: (op: FileOp, reason: string) => void): () => void {
        return room()?.onFilesRefused(listener) ?? (() => {})
      },

      selectThread(threadId: string) {
        if (!isRoomId(threadId)) return
        const id = threadId as RoomId
        if (activeId() === id) return
        setActiveId(id)
        openRoom(id)
      },

      resumeChat(): RoomId | null {
        const user = userStore()
        if (!user) return null
        return resumeChat(user.chats(), user.state.loaded && (user.state.synced || user.state.chats.length > 0), [
          localLast(),
          user.state.lastChat,
        ])
      },

      kikoChatId(): RoomId | undefined {
        return userStore()
          ?.chats()
          .find((c) => c.kiko)?.roomId
      },

      chat,

      activeMessages(): ChatMessage[] {
        return activeRows()
      },

      loadOlder(): void {
        const r = room()
        if (!r || olderBusy || olderDone === r) return
        olderBusy = true
        void r.loadOlder().then(
          (n) => {
            olderBusy = false
            if (n === NO_MORE) olderDone = r
          },
          () => (olderBusy = false),
        )
      },

      followLatest(): void {
        const r = room()
        if (!r) return
        r.follow()
        if (olderDone === r) olderDone = null
      },

      holdWindow(): void {
        room()?.hold()
      },

      searchRoom(query: string, before?: number): Promise<SearchPage | null> {
        return room()?.search(query, before) ?? Promise.resolve(null)
      },

      async jumpTo(seq: number): Promise<boolean> {
        const r = room()
        if (!r) return false
        await r.ready
        const found = await r.jumpTo(seq)
        if (found && olderDone === r) olderDone = null
        return found
      },

      showingHistory(): boolean {
        return !!room()?.state.history
      },

      goLive(): void {
        room()?.live()
      },

      messageById(messageId: string): ChatMessage | undefined {
        const r = room()
        const m = findView(messageId)
        return m && r ? toChatMessage(m, r.state.roomId) : undefined
      },

      messagesFor(threadId: string): ChatMessage[] {
        if (room()?.state.roomId === threadId) return app.activeMessages()
        return (preloaded()[threadId] ?? []).map((m) => toChatMessage(m, threadId))
      },

      firstUnreadMessageId(): string | null {
        const r = room()
        if (!r) return null
        anchorEpoch()
        freezeAnchor()
        const id = anchors.get(r)
        if (!id) return null
        const held = roomMessages()
        if (held.some((m) => m.id === id)) return id
        const read = Math.max(openRead.get(r) ?? r.state.readSeq, localRead.get(r.state.roomId) ?? 0)
        return firstUnread(held, read)
      },

      chatFaces(roomId: string): string[] {
        const chat = userStore()
          ?.chats()
          .find((c) => c.roomId === roomId)
        return chatFaces(chat ?? { roomId }, userStore()?.agents() ?? [])
      },

      roomMembers(): Member[] {
        const r = room()
        return r ? liveMembers(r) : []
      },

      modelsSynced(): boolean {
        const user = userStore()
        return !!user && user.state.loaded && (user.state.synced || Object.keys(user.state.agentModels).length > 0)
      },

      agentModel(slug: string): AgentModel | undefined {
        return userStore()?.agentModel(slug)
      },

      setAgentModel(
        slug: AgentSlug,
        pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[] },
      ) {
        userStore()?.setAgentModel(slug, { ...pick, ...(room() ? { roomId: room()!.state.roomId } : {}) })
      },

      modelAgents(): { slug: AgentSlug; name: string }[] {
        const mine = (userStore()?.agents() ?? []).map((a) => ({ slug: a.slug, name: a.name }))
        return [{ slug: KIKO as AgentSlug, name: "Kiko" }, ...mine.filter((a) => a.slug !== KIKO)]
      },

      memberOp(op: MemberOp) {
        room()?.member(op)
      },

      onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void {
        return room()?.onMemberRefused(listener) ?? (() => {})
      },

      typingDoings(): (string | undefined)[] {
        const r = room()
        return this.typingSlugs().map(
          (slug) => r?.state.doing[slug] ?? (r?.state.status[slug as never] === "working" ? "using a tool" : undefined),
        )
      },

      runWindow(m: ChatMessage): string | undefined {
        return m.botId && m.steps ? windowKey(m.botId, m.stepAfter ?? 0) : undefined
      },

      typingRun(slug: string): string | undefined {
        const r = room()
        if (!r?.state.live[slug]) return undefined
        const after = newestAfter(r.state.steps[slug] ?? [])
        return after >= 0 && !windows().has(windowKey(slug, after)) ? windowKey(slug, after) : undefined
      },

      runSteps(key: string): readonly RunStep[] {
        const { slug, after } = parseWindow(key)
        return inWindow(room()?.state.steps[slug] ?? [], after)
      },

      runLive(key: string): boolean {
        return !windows().has(key) && !!room()?.state.live[parseWindow(key).slug]
      },

      loadRunSteps(key: string, force = false) {
        const r = room()
        const w = windows().get(key)
        if (r && w && inWindow(r.state.steps[w.slug] ?? [], w.after).length < w.steps)
          r.requestSteps(w.slug, w.after, force)
      },

      runFetching(key: string): boolean {
        return !!room()?.state.fetching[key]
      },

      typingSlugs(): string[] {
        return typingOf(room())
      },

      typingNames(): string[] {
        const r = room()
        if (!r) return []
        return typingOf(r).map((slug) => agentDisplayName(slug, r.state.members))
      },

      typing() {
        room()?.typing()
      },

      hasUnread(): boolean {
        const r = room()
        if (!r) return false
        const read = Math.max(r.readSeq(), localRead.get(r.state.roomId) ?? 0)
        return r.state.connection === "open" && newestSeq(roomMessages()) > read
      },

      toggleReaction(messageId: string, emoji: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || m.pending) return
        r.react(m.id, nextReaction(m.reactions, emoji))
      },

      editMessage(messageId: string, text: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || m.pending || m.from.kind !== "human" || text.trim() === "" || text === m.text) return
        r.edit(m.id, text)
      },

      retryRun(messageId: string) {
        const m = findView(messageId)
        if (m?.pending && !m.failed) return
        if (m?.failed && m.clientId) return room()?.retrySend(m.clientId)
        room()?.retry(messageId as MessageId)
      },

      deleteMessage(messageId: string) {
        const r = room()
        const m = findView(messageId)
        if (!r || !m || (m.pending && !m.failed) || m.from.kind !== "human") return
        if (m.failed && m.clientId) return void r.discardSend(m.clientId)
        r.remove(m.id)
      },

      appendMessage(message: OutgoingMessage, _sentAt?: number): string | undefined {
        return send(message)
      },

      appendReply(message: OutgoingMessage, replyToId: string, quote?: string): string | undefined {
        return send(message, replyToId, quote)
      },

      markRead(threadId: string) {
        const r = room()
        if (!r || r.state.roomId !== threadId) return
        clearUnreadMark(threadId)
        const read = Math.max(r.readSeq(), localRead.get(r.state.roomId) ?? 0)
        const fresh = roomMentions().filter((m) => m.seq > read && !unseen().includes(m.id))
        if (fresh.length) setUnseen((list) => [...list, ...fresh.map((m) => m.id)])
        const newest = newestSeq(roomMessages())
        if (newest > (localRead.get(r.state.roomId) ?? 0)) localRead.set(r.state.roomId, newest)
        r.markRead(newest)
      },

      unseenMentions(): readonly MessageId[] {
        const live = new Set(roomMentions().map((m) => m.id))
        return unseen().filter((id) => live.has(id))
      },

      seeMentions(ids: readonly string[]) {
        if (ids.length) setUnseen((list) => list.filter((id) => !ids.includes(id)))
      },

      agents(): Agent[] {
        return userStore()?.agents() ?? []
      },

      rows<K extends RowKind>(kind: K): UserRows[K][] {
        return userStore()?.rows(kind) ?? []
      },

      row<K extends RowKind>(kind: K, id: string): UserRows[K] | undefined {
        return userStore()
          ?.rows(kind)
          .find((r) => r.id === id)
      },

      editRow<K extends RowKind>(
        kind: K,
        id: string,
        next: UserRows[K] | null,
        send: () => Promise<boolean>,
      ): Promise<boolean> {
        return userStore()?.editRow(kind, id, next, send) ?? Promise.resolve(false)
      },

      togglePinned(threadId: string) {
        const user = userStore()
        const c = chat(threadId)
        if (user && c && !c.kiko) user.pin(c.roomId, !c.pinned)
      },
    }
    return app
  })
}

export const useApp = createApp()
