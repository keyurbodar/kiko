import {
  fileName,
  humanHandle,
  isRoomId,
  mentionsHuman,
  messageLast,
  type AgentSlug,
  type AgentState,
  type Chat,
  type ChatLast,
  type FileOp,
  type FileRef,
  type HumanAnswers,
  type HumanAsk,
  type Member,
  type MemberOp,
  type MemberRefusal,
  type Message,
  type MessageId,
  type Reaction as WireReaction,
  type RoomId,
  type RoomSignal,
  type RunStep,
  type SearchHit,
  type Task,
  type ThinkingLevel,
} from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import type { RoomState } from "@kiko/client-runtime/state"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import { batch, createComputed, createMemo, createRoot, createSignal, on, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { session as signedIn } from "../app/session"
import { arriveLine, hideLine, NO_LINE, openLine, sendLine, showLine, type UnreadLine } from "../chat/lib/unread-line"
import { inWindow, newestAfter, parseWindow, stepWindows, upsertStep, windowKey } from "../chat/run/run-log"
import { fillComposer } from "../composer/fill"
import { distinctTitles, resumeChat, rosterChats } from "../lib/chats"
import { seenInChat, showFailure, showNotice } from "../lib/errors"
import { fileUrl } from "../lib/file-token"
import { chatFaces } from "../lib/identity"
import { agentDisplayName } from "../lib/names"
import type { BotPresence, ChatMessage, OutgoingMessage, Reaction, RosterBot } from "../lib/types"
import { describeLast, isListed } from "../sidebar/activity"
import { clearUnreadMark } from "../sidebar/unread-mark"
import { connection } from "./connection"
import { liveLine, liveStatusOf, thinkingLine, type LiveStatus } from "./live-status"
import { createThoughts, type ThinkingSignal, type Thought } from "./thoughts"
import { attempt, observe, owner, registry, valueOf, watch } from "./runtime"
import { onUserSignal, user } from "./user"

const PENDING_SEQ = Number.MAX_SAFE_INTEGER
const HISTORY_PAGE = 30
const TYPING_EVERY_MS = 2_000
const WARM_ROOMS = 4

export const fileSrc = (roomId: string, fileId: string) => fileUrl(`/api/files/${roomId}/${encodeURIComponent(fileId)}`)

const isPending = (m: Pick<Message, "seq">) => m.seq === PENDING_SEQ

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

function copyOptional(out: ChatMessage, m: Message): void {
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
}

function toChatMessage(m: Message, roomId: string): ChatMessage {
  const pending = isPending(m)
  const out: ChatMessage = {
    id: m.id,
    threadId: roomId,
    sender: m.from.kind === "human" ? "user" : "bot",
    body: m.text,
    sentAt: Number.isFinite(m.at) ? m.at : Date.now(),
  }
  if (m.from.kind === "agent") out.botId = m.from.slug
  if (m.clientId) out.clientId = m.clientId
  if (!pending) out.seq = m.seq
  copyOptional(out, m)
  const chips = reactionChips(m.reactions)
  if (chips) out.reactions = chips
  if (m.files?.length)
    out.files = m.files.map((f) => ({
      name: fileName(f.name),
      path: f.name,
      size: f.size,
      type: f.type,
      src: fileSrc(roomId, f.id),
    }))
  if (m.from.kind === "human") out.status = pending ? "sending" : "sent"
  return out
}

function newestSeq(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (!isPending(messages[i]!)) return messages[i]!.seq
  return 0
}

function presenceOf(live: LiveStatus | undefined): BotPresence {
  if (!live) return "idle"
  return live.kind === "tool" ? "working" : "typing"
}

type LiveRow = { last?: ChatLast; typing?: readonly string[]; line?: string; group?: boolean }

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
    presence: typing.length && presence === "idle" ? "typing" : presence,
    unread: chat.unread,
    pinned: chat.pinned,
  }
  if (last) row.lastFrom = last.from
  if (line.from) row.previewFrom = line.from
  if (live.line) row.typing = live.line
  else if (typing.length) row.typing = thinkingLine(typing, group)
  if (chat.mentions) row.mentions = chat.mentions
  return row
}

function viewLast(m: Message, name: (slug: string) => string): ChatLast {
  return messageLast({
    from: m.from.kind,
    ...(m.from.kind === "agent" ? { name: name(m.from.slug) } : {}),
    text: m.text,
    ...(m.rich ? { rich: m.rich, mentionName: name } : {}),
    ...(m.files ? { files: m.files } : {}),
    at: m.at,
  })
}

function mentionIds(messages: readonly Message[], handle: string | null, slugs: readonly string[]) {
  const own = handle && !slugs.includes(handle) ? handle : null
  const human = new Set(messages.filter((m) => m.from.kind === "human").map((m) => m.id))
  return messages
    .filter(
      (m) =>
        !isPending(m) &&
        m.from.kind === "agent" &&
        m.to === undefined &&
        mentionsHuman(m.text, own, !!m.replyTo && human.has(m.replyTo)),
    )
    .map((m) => ({ id: m.id, seq: m.seq }))
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

export type SearchPage = { results: readonly SearchHit[]; next: number | null }

type Runs = {
  steps: Record<string, RunStep[]>
  live: Record<string, boolean | undefined>
  fetching: Record<string, boolean | undefined>
}

const emptyRuns = (): Runs => ({ steps: {}, live: {}, fetching: {} })
const NO_RUNS: Runs = emptyRuns()

export interface ActiveRoom {
  readonly roomId: RoomId
  asks(): readonly HumanAsk[]
  answer(id: string, value: string | HumanAnswers): void
  skip(id: string): void
  members(): readonly Member[]
  tasks(): readonly Task[]
}

const NO_ROOM_STATE = Atom.make<RoomState | undefined>(undefined)
const NO_CACHE = Atom.make<Atom.Type<ReturnType<typeof owner.cachedRoomAtom>> | undefined>(undefined)

const notConnected = () =>
  showToastV2({
    title: "Not connected: message not sent",
    description: "Reconnecting to Kiko. Try again once it is connected.",
    variant: "error",
  })

function eachWarm(ids: () => readonly RoomId[], open: (id: RoomId) => () => void) {
  const held = new Map<RoomId, () => void>()
  createComputed(() => {
    const next = new Set(ids())
    untrack(() => {
      for (const [id, close] of held)
        if (!next.has(id)) {
          held.delete(id)
          close()
        }
      for (const id of next) if (!held.has(id)) held.set(id, open(id))
    })
  })
}

function createWarmRooms(roomId: () => RoomId | null, exists: (id: RoomId) => boolean) {
  const [recent, setRecent] = createSignal<readonly RoomId[]>([])
  createComputed(
    on(roomId, (id) => {
      if (id !== null) setRecent((list) => [id, ...list.filter((other) => other !== id)].slice(0, WARM_ROOMS))
    }),
  )
  const warm = createMemo(() => recent().filter(exists), [], {
    equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  })
  eachWarm(warm, (id) => registry.mount(owner.roomAtom(id)))
  return warm
}

function createRuns(
  roomId: () => RoomId | null,
  warm: () => readonly RoomId[],
  onStatus: (id: RoomId, slug: string, state: AgentState) => void,
  onThinking: (id: RoomId, signal: ThinkingSignal) => void,
) {
  const [all, setAll] = createStore<Record<string, Runs>>({})
  const fetched = new Map<RoomId, Set<string>>()
  const fetchedIn = (id: RoomId) => {
    let keys = fetched.get(id)
    if (!keys) fetched.set(id, (keys = new Set()))
    return keys
  }
  const take = (id: RoomId, incoming: readonly RunStep[], live: boolean) => {
    if (incoming.length === 0) return
    setAll(
      produce((s) => {
        const runs = (s[id] ??= emptyRuns())
        for (const step of incoming) {
          runs.steps[step.slug] = upsertStep(runs.steps[step.slug] ?? [], step)
          if (live || step.status === "running") runs.live[step.slug] = true
        }
      }),
    )
  }
  const onSignal = (id: RoomId, signal: RoomSignal) => {
    if (signal.t === "step") take(id, [signal.step], false)
    else if (signal.t === "thinking") onThinking(id, signal)
    else if (signal.t === "status") {
      onStatus(id, signal.slug, signal.state)
      if (signal.state === "idle" && all[id]) setAll(id, "live", signal.slug, undefined)
    } else if (signal.t === "error" && id === roomId()) showNotice(signal.error)
  }
  eachWarm(warm, (id) => {
    const stop = observe(
      owner.roomSignalAtom(id),
      (next) => {
        const burst = valueOf(next)
        if (burst !== undefined && Option.isSome(burst))
          untrack(() => burst.value.forEach((signal) => onSignal(id, signal)))
      },
      { immediate: true },
    )
    return () => {
      stop()
      fetched.delete(id)
      setAll(produce((s) => void delete s[id]))
    }
  })
  const clear = (id: RoomId) => {
    fetched.delete(id)
    if (all[id]) setAll(id, { live: {}, fetching: {} })
  }
  const clearAll = () => {
    for (const id of Object.keys(all)) clear(id as RoomId)
  }
  async function request(slug: string, after: number, force: boolean) {
    const id = roomId()
    const key = windowKey(slug, after)
    if (!id || all[id]?.fetching[key] || (!force && fetched.get(id)?.has(key))) return
    setAll(produce((s) => void ((s[id] ??= emptyRuns()).fetching[key] = true)))
    const steps = await attempt(owner.commands.steps, { roomId: id, slug: slug as AgentSlug, after }, () => {})
    if (all[id]) setAll(id, "fetching", key, undefined)
    if (steps === undefined || !all[id]) return
    fetchedIn(id).add(key)
    take(id, steps, false)
  }
  const current = () => {
    const id = roomId()
    return (id !== null && all[id]) || NO_RUNS
  }
  return { current, take, clear, clearAll, request }
}

function createTyping(roomId: () => RoomId | null) {
  let lastAt = Number.NEGATIVE_INFINITY
  createComputed(on(roomId, () => (lastAt = Number.NEGATIVE_INFINITY)))
  return {
    sent: () => (lastAt = Number.NEGATIVE_INFINITY),
    ping() {
      const id = roomId()
      const now = Date.now()
      if (!id || !connection.connected() || now - lastAt < TYPING_EVERY_MS) return
      lastAt = now
      void attempt(owner.commands.typing, { roomId: id }, () => {})
    },
  }
}

function createHistory(roomId: () => RoomId | null, live: () => readonly Message[]) {
  const [shown, setShown] = createSignal<readonly Message[] | null>(null)
  let olderBusy = false
  let olderDone: RoomId | null = null
  let newerBusy = false
  createComputed(
    on(roomId, () =>
      batch(() => {
        setShown(null)
        olderDone = null
      }),
    ),
  )
  const page = (seq: number, before: number, after: number, merge: boolean) => {
    const id = roomId()
    if (!id) return Promise.resolve(undefined)
    return attempt(owner.commands.history, { roomId: id, seq, before, after, merge }, () => {})
  }
  async function loadOlder() {
    const id = roomId()
    if (!id || olderBusy || olderDone === id) return
    const list = shown() ?? live()
    const oldest = list.find((m) => !isPending(m))?.seq
    if (oldest === undefined || oldest <= 1) return
    olderBusy = true
    try {
      const older = await page(oldest, HISTORY_PAGE * 2, 0, shown() === null)
      if (roomId() !== id || older === undefined) return
      if (older.length === 0) olderDone = id
      const held = shown()
      if (held !== null) setShown([...older.filter((m) => m.seq < (held[0]?.seq ?? Infinity)), ...held])
    } finally {
      olderBusy = false
    }
  }
  async function loadNewer() {
    const held = shown()
    const id = roomId()
    if (!held || !id || newerBusy) return
    newerBusy = true
    try {
      const from = (held.at(-1)?.seq ?? 0) + 1
      const next = await page(from, 0, HISTORY_PAGE * 2, false)
      if (!next || roomId() !== id || shown() !== held) return
      const tail = live()
      const reaches = next.length < HISTORY_PAGE * 2 || tail.length === 0 || next.some((m) => m.seq >= tail[0]!.seq)
      if (reaches) {
        await page(held[0]?.seq ?? from, 0, HISTORY_PAGE * 4, true)
        setShown(null)
      } else setShown([...held, ...next.filter((m) => m.seq > (held.at(-1)?.seq ?? 0))])
    } finally {
      newerBusy = false
    }
  }
  async function jumpTo(seq: number): Promise<boolean> {
    const has = (list: readonly Message[] | null) => !!list?.some((m) => m.seq === seq)
    if (has(shown())) return true
    if (has(live())) {
      setShown(null)
      return true
    }
    const found = await page(seq, HISTORY_PAGE, HISTORY_PAGE, false)
    if (!found?.some((m) => m.seq === seq)) return false
    const tail = live()
    if (tail.length === 0 || found.at(-1)!.seq >= tail[0]!.seq) {
      await page(seq, HISTORY_PAGE, HISTORY_PAGE, true)
      setShown(null)
    } else setShown(found)
    return true
  }
  return {
    shown,
    loadOlder,
    jumpTo,
    follow: () => void loadNewer(),
    live: () => setShown(null),
    resetDone: () => (olderDone = null),
  }
}

const sendInput = (input: {
  roomId: RoomId
  text: string
  commandId: string
  replyTo?: MessageId
  quote?: string
  attachments?: OutgoingMessage["attachments"]
}) => ({
  roomId: input.roomId,
  text: input.text,
  commandId: input.commandId as never,
  ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  ...(input.quote ? { quote: input.quote } : {}),
  ...(input.attachments?.length ? { attachments: input.attachments } : {}),
})

function createRoom() {
  const [routeRoom, setRouteRoom] = createSignal<() => string | null>(() => null)
  const activeId = createMemo(() => {
    const id = routeRoom()()
    return id !== null && isRoomId(id) ? (id as RoomId) : null
  })
  onUserSignal("error", (signal) => {
    if (!seenInChat(signal.roomId, untrack(activeId), document.visibilityState === "visible")) showNotice(signal.error)
  })
  const roomState = watch(() => {
    const id = activeId()
    return id === null ? NO_ROOM_STATE : owner.roomAtom(id)
  })
  const state = createMemo(() => roomState())
  const snapshot = createMemo(() => {
    const s = state()
    return s === undefined ? undefined : Option.getOrUndefined(s.data)
  })
  const streaming = () => {
    const status = state()?.status
    return status === "live" || status === "synchronizing"
  }
  const liveMessages = createMemo(() => snapshot()?.messages ?? [])
  const history = createHistory(activeId, liveMessages)
  const messages = createMemo(() => history.shown() ?? liveMessages())
  const warm = createWarmRooms(activeId, (id) => !user.synced() || user.chat(id) !== undefined)
  const [marks, setMarks] = createSignal<Readonly<Record<string, number>>>({})
  createComputed(on(activeId, () => setMarks({})))
  const thoughts = createThoughts()
  createComputed(on(activeId, thoughts.clear))
  const runs = createRuns(
    activeId,
    warm,
    (id, slug, state) => {
      if (id !== untrack(activeId)) return
      setMarks((all) => ({ ...all, [slug]: newestSeq(untrack(liveMessages)) }))
      if (state === "idle") thoughts.idle(slug)
    },
    (id, signal) => {
      if (id === untrack(activeId)) thoughts.hear(signal, newestSeq(untrack(liveMessages)))
    },
  )
  const typing = createTyping(activeId)

  createComputed(
    on(
      () => snapshot()?.steps,
      (steps) => {
        const id = untrack(activeId)
        if (steps && id) untrack(() => runs.take(id, steps, true))
      },
    ),
  )
  createComputed(
    on(
      () => [activeId(), streaming()] as const,
      ([id, live], previous) => {
        if (id && !live && previous?.[0] === id && previous[1]) untrack(() => runs.clear(id))
      },
    ),
  )
  createComputed(on(connection.connected, (connected) => !connected && untrack(runs.clearAll), { defer: true }))

  const statusOf = createMemo(() => {
    const out: Record<string, AgentState> = {}
    if (streaming()) for (const a of snapshot()?.agents ?? []) out[a.slug] = a.state
    return out
  })
  const liveOf = createMemo(() => {
    const out: Record<string, LiveStatus> = {}
    if (!streaming()) return out
    const list = liveMessages()
    for (const a of snapshot()?.agents ?? []) {
      const live = liveStatusOf({
        slug: a.slug,
        status: a,
        messages: list.filter((m) => !isPending(m) && !m.event),
        mark: marks()[a.slug],
        running: (runs.current().steps[a.slug] ?? []).some((step) => step.status === "running"),
      })
      if (live.kind !== "idle") out[a.slug] = live
    }
    return out
  })
  const liveStates = createMemo(() => {
    const out: Record<string, AgentState> = {}
    const raw = statusOf()
    for (const slug of Object.keys(liveOf())) if (raw[slug]) out[slug] = raw[slug]
    return out
  })

  const views = new WeakMap<Message, ChatMessage>()
  const rows = createMemo(() => {
    const id = activeId()
    if (!id) return [] as ChatMessage[]
    return messages().map((m) => {
      const cached = views.get(m)
      if (cached && cached.threadId === id) return cached
      const view = toChatMessage(m, id)
      views.set(m, view)
      return view
    })
  })
  const windows = createMemo(() => stepWindows(rows()))
  const thoughtAnchors = createMemo(() => {
    const out = new Map<string, Thought>()
    for (const list of Object.values(thoughts.all()))
      for (const thought of list) {
        const reply = rows().find(
          (m) => m.botId === thought.slug && !m.event && m.seq !== undefined && m.seq > thought.after,
        )
        if (reply) out.set(reply.id, thought)
      }
    return out
  })

  const members = createMemo(() => (snapshot()?.members ?? []).filter((m) => !user.isGone(m.slug)))
  const memberRows = createMemo(() => members().map((m) => memberRow(m, presenceOf(liveOf()[m.slug]))))
  const typingSlugs = createMemo(() => {
    const known = new Set(members().map((m) => m.slug as string))
    return Object.keys(liveOf()).filter((slug) => known.has(slug)) as AgentSlug[]
  })

  const localRead = new Map<RoomId, number>()
  const [unseen, setUnseen] = createSignal<readonly MessageId[]>([])
  createComputed(on(activeId, () => setUnseen([])))
  const readSeq = () => snapshot()?.readSeq ?? 0

  const [line, setLine] = createSignal<UnreadLine>(NO_LINE)
  const [tabHidden, setTabHidden] = createSignal(document.visibilityState === "hidden")
  document.addEventListener("visibilitychange", () => setTabHidden(document.visibilityState === "hidden"))
  const said = createMemo(() =>
    liveMessages().flatMap((m) =>
      isPending(m) ? [] : [{ id: m.id, seq: m.seq, at: m.at, agent: !m.event && m.from.kind !== "human" }],
    ),
  )
  let lineRoom: RoomId | null = null
  let openMark: number | undefined
  let lineOpen = false
  createComputed(() => {
    const id = activeId()
    if (id !== lineRoom) {
      lineRoom = id
      openMark = undefined
      lineOpen = false
      setLine(NO_LINE)
    }
    const s = snapshot()
    if (!id || !s || lineOpen) return
    openMark ??= Math.max(s.readSeq, localRead.get(id) ?? 0)
    if (state()?.status !== "live") return
    lineOpen = true
    setLine(openLine(untrack(said), openMark, untrack(tabHidden)))
  })
  createComputed(() => {
    const list = said()
    setLine((now) => arriveLine(now, list))
  })
  createComputed(
    on(tabHidden, (hidden) => setLine((now) => (hidden ? hideLine(now, untrack(said)) : showLine(now, Date.now()))), {
      defer: true,
    }),
  )

  function firstUnreadMessageId(): string | null {
    const anchor = line().anchor
    return anchor !== null && messages().some((m) => m.id === anchor) ? anchor : null
  }

  const handle = () => {
    const s = signedIn()
    return s.status === "signed-in" ? humanHandle(s.user.name) : null
  }
  const roomMentions = createMemo(() =>
    activeId()
      ? mentionIds(
          messages(),
          handle(),
          members().map((m) => m.slug),
        )
      : [],
  )

  const shownRows = new Map<string, RosterBot>()
  const stableRow = (row: RosterBot) => {
    const old = shownRows.get(row.id)
    if (old && sameRow(old, row)) return old
    shownRows.set(row.id, row)
    return row
  }
  const titledChats = createMemo(() => distinctTitles(user.chats()))
  const idleRows = createMemo(() => {
    const id = activeId()
    const typingIn = user.typingByRoom()
    const out = new Map<string, RosterBot>()
    for (const c of titledChats())
      if (c.roomId !== id) out.set(c.roomId, stableRow(chatRow(c, "idle", { typing: typingIn[c.roomId] })))
    return out
  })
  const activeChat = createMemo(() => titledChats().find((c) => c.roomId === activeId()))
  const activeBotRow = createMemo(() => {
    const c = activeChat()
    return c && stableRow(activeRow(c))
  })
  const botRows = createMemo<RosterBot[]>(() => {
    const idle = idleRows()
    const current = activeBotRow()
    const out = titledChats().flatMap((c) => (c.roomId === current?.id ? current : (idle.get(c.roomId) ?? [])))
    const listed = new Set(out.map((row) => row.id))
    for (const id of shownRows.keys()) if (!listed.has(id)) shownRows.delete(id)
    return out
  })
  function activeRow(c: Chat): RosterBot {
    const list = liveMessages()
    const name = (slug: string) => agentDisplayName(slug, members())
    const newest = list.findLast(isListed)
    const fresh = newest && (isPending(newest) || newest.seq > c.lastSeq) ? viewLast(newest, name) : undefined
    const live = Object.entries(liveOf()).map(([slug, status]) => ({ name: name(slug), status }))
    const row = chatRow(c, live.length ? presenceOf(live[0]!.status) : "idle", {
      ...(fresh ? { last: fresh } : {}),
      ...(live.length ? { line: liveLine(live, members().length > 1) ?? undefined } : {}),
      ...(members().length ? { group: members().length > 1 } : {}),
    })
    if (history.shown() === null && readSeq() >= newestSeq(list)) {
      row.unread = 0
      delete row.mentions
    }
    return row
  }
  const botIndex = createMemo(() => new Map(botRows().map((row) => [row.id, row])))
  const roster = createMemo(() => rosterChats(user.chats()).flatMap((c) => botIndex().get(c.roomId) ?? []))

  const lastKey = () => {
    const s = signedIn()
    return s.status === "signed-in" ? `kiko.last-chat:${s.user.id}` : null
  }
  const [localLast, setLocalLast] = createSignal<string | null>(null)
  createComputed(() => {
    const key = lastKey()
    untrack(() => {
      try {
        setLocalLast(key ? localStorage.getItem(key) : null)
      } catch {
        setLocalLast(null)
      }
    })
  })
  function remember(id: RoomId) {
    setLocalLast(id)
    const key = lastKey()
    try {
      if (key) localStorage.setItem(key, id)
    } catch {}
    user.open(id)
  }

  createComputed(() => {
    const id = activeId()
    if (id && user.loaded()) untrack(() => remember(id))
  })

  const findMessage = (id: string) => messages().find((m) => m.id === id)

  const sendRefusals = new Set<(reason: string) => void>()
  async function deliver(
    roomId: RoomId,
    text: string,
    extra: Omit<Parameters<typeof sendInput>[0], "roomId" | "text">,
  ) {
    const result = await attempt(owner.commands.sendMessage, sendInput({ roomId, text, ...extra }), (reason) => {
      fillComposer(roomId, text)
      showFailure(reason)
      for (const listener of sendRefusals) listener(reason)
    })
    return result !== undefined
  }

  function send(message: OutgoingMessage, replyTo?: string, quote?: string): string | undefined {
    const id = activeId()
    if (!id || (message.body.trim().length === 0 && !(message.attachments?.length ?? 0))) return undefined
    if (!connection.connected()) {
      notConnected()
      return undefined
    }
    const stored = replyTo !== undefined && !replyTo.startsWith("local:")
    const commandId = crypto.randomUUID()
    typing.sent()
    history.live()
    void deliver(id, message.body, {
      commandId,
      ...(stored ? { replyTo: replyTo as MessageId, ...(quote ? { quote } : {}) } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    })
    setLine(sendLine)
    return `local:${commandId}`
  }

  const refusal =
    <T>(set: Set<(op: T, reason: string) => void>, op: T) =>
    (reason: string) => {
      if (set.size === 0) showFailure(reason)
      for (const listener of set) listener(op, reason)
    }
  const fileRefusals = new Set<(op: FileOp, reason: string) => void>()
  const memberRefusals = new Set<(op: MemberOp, reason: MemberRefusal) => void>()
  const listen = <F>(set: Set<F>, listener: F) => {
    set.add(listener)
    return () => void set.delete(listener)
  }

  const active = createMemo<ActiveRoom | undefined>(() => {
    const id = activeId()
    if (!id) return undefined
    return {
      roomId: id,
      asks: () => snapshot()?.asks ?? [],
      answer: (askId, value) => void attempt(owner.commands.answer, { roomId: id, askId, value }, showFailure),
      skip: (askId) => void attempt(owner.commands.skip, { roomId: id, askId }, showFailure),
      members,
      tasks: () => snapshot()?.tasks ?? [],
    }
  })

  return {
    activeId,
    active,
    state,
    snapshot,
    status: liveStates,
    followRoute: (room: () => string | null) => setRouteRoom(() => room),
    messages: rows,
    messageById: (id: string) => rows().find((m) => m.id === id),
    bots: roster,
    chatById: (id: string) => botIndex().get(id),
    members: memberRows,
    memberById: (slug: string | undefined) =>
      slug === undefined ? undefined : memberRows().find((m) => m.id === slug),
    roomMembers: members,
    tasks: () => snapshot()?.tasks ?? [],
    files: (): FileRef[] => [...(snapshot()?.files ?? [])],
    folders: (): string[] => [...(snapshot()?.folders ?? [])],
    fileOp(op: FileOp) {
      const id = activeId()
      if (id) void attempt(owner.commands.roomFiles, { roomId: id, op }, refusal(fileRefusals, op))
    },
    onFilesRefused: (listener: (op: FileOp, reason: string) => void) => listen(fileRefusals, listener),
    memberOp(op: MemberOp) {
      const id = activeId()
      if (id)
        void attempt(owner.commands.member, { roomId: id, op }, (reason) => {
          for (const listener of memberRefusals) listener(op, reason as MemberRefusal)
          if (memberRefusals.size === 0) showFailure(reason)
        })
    },
    onMemberRefused: (listener: (op: MemberOp, reason: MemberRefusal) => void) => listen(memberRefusals, listener),
    onSendRefused: (listener: (reason: string) => void) => listen(sendRefusals, listener),
    send,
    loadOlder: () => void history.loadOlder(),
    followLatest: () => {
      history.resetDone()
      if (history.shown() !== null) history.follow()
    },
    jumpTo: history.jumpTo,
    showingHistory: () => history.shown() !== null,
    goLive: history.live,
    async searchRoom(query: string, before?: number): Promise<SearchPage | null> {
      const id = activeId()
      if (!id) return null
      const page = await attempt(
        owner.commands.roomSearch,
        { roomId: id, query, ...(before === undefined ? {} : { before }) },
        () => {},
      )
      return page ? { results: page.results, next: page.next } : null
    },
    firstUnreadMessageId,
    tabHidden,
    resumeChat: () =>
      resumeChat(user.chats(), user.synced() || (user.loaded() && user.chats().length > 0), [
        localLast(),
        user.lastChat(),
      ]),
    chatFaces: (roomId: string) => chatFaces(user.chat(roomId) ?? { roomId }, user.agents()),
    typing: typing.ping,
    typingSlugs,
    typingNames: () => typingSlugs().map((slug) => agentDisplayName(slug, members())),
    typingDoings: () => typingSlugs().map((slug) => liveOf()[slug]?.text),
    thinking: (slug: string) => thoughts.latest(slug),
    thoughtFor: (m: ChatMessage) => thoughtAnchors().get(m.id),
    runWindow: (m: ChatMessage) => (m.botId && m.steps ? windowKey(m.botId, m.stepAfter ?? 0) : undefined),
    typingRun(slug: string): string | undefined {
      if (!runs.current().live[slug]) return undefined
      const after = newestAfter(runs.current().steps[slug] ?? [])
      return after >= 0 && !windows().has(windowKey(slug, after)) ? windowKey(slug, after) : undefined
    },
    runSteps(key: string): readonly RunStep[] {
      const { slug, after } = parseWindow(key)
      return inWindow(runs.current().steps[slug] ?? [], after)
    },
    runLive: (key: string) => !windows().has(key) && !!runs.current().live[parseWindow(key).slug],
    loadRunSteps(key: string, force = false) {
      const w = windows().get(key)
      if (w && inWindow(runs.current().steps[w.slug] ?? [], w.after).length < w.steps)
        void runs.request(w.slug, w.after, force)
    },
    runFetching: (key: string) => !!runs.current().fetching[key],
    hasUnread(): boolean {
      const id = activeId()
      if (!id) return false
      return streaming() && newestSeq(messages()) > Math.max(readSeq(), localRead.get(id) ?? 0)
    },
    markRead(threadId: string) {
      const id = activeId()
      if (!id || id !== threadId) return
      clearUnreadMark(threadId)
      const read = Math.max(readSeq(), localRead.get(id) ?? 0)
      const fresh = roomMentions().filter((m) => m.seq > read && !unseen().includes(m.id))
      if (fresh.length) setUnseen((list) => [...list, ...fresh.map((m) => m.id)])
      const newest = newestSeq(messages())
      if (newest <= (localRead.get(id) ?? 0)) return
      localRead.set(id, newest)
      void attempt(owner.commands.markRead, { roomId: id, seq: newest }, () => {})
    },
    unseenMentions(): readonly MessageId[] {
      const live = new Set(roomMentions().map((m) => m.id))
      return unseen().filter((id) => live.has(id))
    },
    seeMentions(ids: readonly string[]) {
      if (ids.length) setUnseen((list) => list.filter((id) => !ids.includes(id)))
    },
    toggleReaction(messageId: string, emoji: string) {
      const id = activeId()
      const m = findMessage(messageId)
      if (!id || !m || isPending(m)) return
      void attempt(
        owner.commands.react,
        { roomId: id, messageId: m.id, emoji: nextReaction(m.reactions, emoji) },
        showFailure,
      )
    },
    editMessage(messageId: string, text: string) {
      const id = activeId()
      const m = findMessage(messageId)
      if (!id || !m || isPending(m) || m.from.kind !== "human" || text.trim() === "" || text === m.text) return
      void attempt(owner.commands.editMessage, { roomId: id, messageId: m.id, text }, showFailure)
    },
    retryRun(messageId: string) {
      const id = activeId()
      const m = findMessage(messageId)
      if (!id || (m && isPending(m))) return
      void attempt(owner.commands.retry, { roomId: id, messageId: messageId as MessageId }, showFailure)
    },
    deleteMessage(messageId: string) {
      const id = activeId()
      const m = findMessage(messageId)
      if (!id || !m || isPending(m) || m.from.kind !== "human") return
      void attempt(owner.commands.deleteMessage, { roomId: id, messageId: m.id }, showFailure)
    },
    setAgentModel(
      slug: AgentSlug,
      pick: { ref?: string; name?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[] },
    ) {
      const id = activeId()
      user.setAgentModel(slug, { ...pick, ...(id ? { roomId: id } : {}) })
    },
    setModel(ref: string, slug?: AgentSlug) {
      const id = activeId()
      if (id) void attempt(owner.commands.setRoomModel, { roomId: id, ref, ...(slug ? { slug } : {}) }, showFailure)
    },
    stop() {
      const id = activeId()
      if (id) void attempt(owner.commands.stop, { roomId: id }, showFailure)
    },
  }
}

export const room = createRoot(createRoom)

export function cachedTail(roomId: () => string, wanted: () => boolean): () => ChatMessage[] {
  const cached = watch(() => (wanted() && isRoomId(roomId()) ? owner.cachedRoomAtom(roomId() as RoomId) : NO_CACHE))
  return () => {
    const result = cached()
    const snapshot = result === undefined ? undefined : valueOf(result)
    if (snapshot === undefined || Option.isNone(snapshot)) return []
    return snapshot.value.snapshot.messages.slice(-6).map((m) => toChatMessage(m, roomId()))
  }
}
