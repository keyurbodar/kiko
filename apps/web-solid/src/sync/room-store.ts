import { humanAnswerText, messageSeq, type HumanAnswers, type KikoError } from "@kiko/protocol"

import type { LocalAttachment } from "./patches"
import type {
  Actor,
  FileOp,
  AgentSlug,
  AgentState,
  AgentStatus,
  ClientToRoom,
  FileRef,
  HumanAsk,
  PendingAttachment,
  Member,
  MemberOp,
  MemberRefusal,
  Message,
  MessageId,
  RoomEvent,
  RoomId,
  RoomSnapshot,
  RoomToClient,
  RunStep,
  SearchHit,
  Task,
  TaskOp,
} from "@kiko/protocol"
import { batch } from "solid-js"
import { $RAW, createStore, produce } from "solid-js/store"
import type { Warm } from "../warm/db"
import {
  deleteMessages,
  getLastSeq,
  KEEP_ON_DISK,
  messagesBefore,
  newestMessages,
  putMessages,
  roomRange,
  setLastSeq,
  dropBefore,
} from "../warm/messages"
import { addToOutbox, outbox, removeFromOutbox } from "../warm/outbox"
import {
  expire,
  overlayFiles,
  overlayFolders,
  overlayMembers,
  overlayMessages,
  overlayReadSeq,
  overlayTasks,
  PATCH_TTL_MS,
  type RoomPatch,
  type RoomPatchFrame,
  settleRoom,
  settleSends,
  type ViewMessage,
} from "./patches"
import { upsertStep, windowKey } from "../chat/run/run-log"
import { type UserChannel, userChannel, type SocketStatus, type RoomChannel } from "./socket"
import { retryFailedUploads } from "./uploads"

export type RoomData = {
  seq: number
  readSeq: number
  members: Member[]
  messages: Message[]
  tasks: Task[]
  files: FileRef[]
  folders: string[]
  agents: AgentStatus[]
  asks: HumanAsk[]
}

const MAX_MESSAGES_IN_MEMORY = 200
const WINDOW_SLACK = 50
const HELD_MESSAGES = 600

const emptyRoom = (): RoomData => ({
  seq: 0,
  readSeq: 0,
  members: [],
  messages: [],
  tasks: [],
  files: [],
  folders: [],
  agents: [],
  asks: [],
})

function fromSnapshot(s: RoomSnapshot): RoomData {
  return {
    seq: s.seq,
    readSeq: s.readSeq,
    members: [...s.members],
    messages: [...s.messages],
    tasks: [...s.tasks],
    files: [...s.files],
    folders: [...s.folders],
    agents: [...(s.agents ?? [])],
    asks: [...(s.asks ?? [])],
  }
}

function toMessage(e: Extract<RoomEvent, { t: "message" }>): Message {
  const { t: _, ...m } = e
  return m
}

const raw = <T>(value: T): T => (value as { [$RAW]?: T })[$RAW] ?? value

const findMessage = (messages: readonly Message[], id: MessageId) => {
  const list = raw(messages)
  for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) return i
  return -1
}

const sameActor = (a: Actor, b: Actor) =>
  a.kind === "human" ? b.kind === "human" : b.kind === "agent" && a.slug === b.slug

const upsert = <T>(list: T[], item: T, same: (x: T) => boolean) => {
  const i = list.findIndex(same)
  if (i === -1) list.push(item)
  else list[i] = item
}

const removeWhere = <T>(list: T[], match: (x: T) => boolean) => {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1)
}

export type Change = { put?: Message; deleted?: Message[]; meta?: true }

function applyRoomEvent(data: RoomData, e: RoomEvent): Change | null {
  if (e.seq <= data.seq) return null
  data.seq = e.seq
  switch (e.t) {
    case "message": {
      const m = toMessage(e)
      const i = findMessage(data.messages, m.id)
      if (i === -1) data.messages.push(m)
      else data.messages[i] = m
      return { put: m }
    }
    case "edit": {
      const i = findMessage(data.messages, e.messageId)
      if (i === -1) return {}
      const m = data.messages[i]
      m.text = e.text
      m.editedAt = e.at
      if (e.rich) m.rich = e.rich
      else delete m.rich
      return { put: raw(m) }
    }
    case "delete": {
      const deleted: Message[] = []
      for (const id of e.messageIds) {
        const i = findMessage(data.messages, id)
        if (i !== -1) deleted.push(raw(data.messages[i]))
        if (i !== -1) data.messages.splice(i, 1)
      }
      for (const m of data.messages)
        if (m.replyTo && m.reply && e.messageIds.includes(m.replyTo))
          m.reply = { seq: m.reply.seq, from: m.reply.from, text: "", gone: true }
      return { deleted }
    }
    case "react": {
      const i = findMessage(data.messages, e.messageId)
      if (i === -1) return {}
      const m = data.messages[i]
      const reactions = (m.reactions ?? []).filter((r) => !sameActor(r.by, e.by))
      if (e.emoji !== null) reactions.push({ by: e.by, emoji: e.emoji })
      if (reactions.length) m.reactions = reactions
      else delete m.reactions
      return { put: raw(m) }
    }
    case "read":
      data.readSeq = Math.max(data.readSeq, e.upTo)
      return { meta: true }
    case "member":
      upsert(data.members, e.member, (x) => x.slug === e.member.slug)
      return { meta: true }
    case "member_removed":
      removeWhere(data.members, (x) => x.slug === e.slug)
      return { meta: true }
    case "task":
      upsert(data.tasks, e.task, (x) => x.id === e.task.id)
      return { meta: true }
    case "task_removed":
      removeWhere(data.tasks, (x) => x.id === e.id)
      return { meta: true }
    case "file":
      removeWhere(data.files, (x) => x.name === e.file.name && x.id !== e.file.id)
      upsert(data.files, e.file, (x) => x.id === e.file.id)
      return { meta: true }
    case "file_removed":
      removeWhere(data.files, (x) => e.ids.includes(x.id))
      return { meta: true }
    case "folders":
      data.folders = [...e.folders]
      return { meta: true }
    case "ask": {
      const { t: _, seq: __, at: ___, ...ask } = e
      upsert(data.asks, ask, (x) => x.id === ask.id)
      return { meta: true }
    }
    case "ask_resolved":
      removeWhere(data.asks, (x) => x.id === e.id)
      return { meta: true }
    default:
      return {}
  }
}

function applyStatus(data: RoomData, status: AgentStatus): void {
  if (status.state === "idle") removeWhere(data.agents, (x) => x.slug === status.slug)
  else upsert(data.agents, status, (x) => x.slug === status.slug)
}

function mergeBySeq(a: readonly Message[], b: readonly Message[]): Message[] {
  const out: Message[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = a[i]
    const y = b[j]
    if (y === undefined || (x !== undefined && x.seq < y.seq)) out.push(a[i++]!)
    else {
      if (x !== undefined && x.seq === y.seq) i++
      out.push(b[j++]!)
    }
  }
  return out
}

function applyToHistory(history: Message[], e: RoomEvent): void {
  if (e.t === "message") {
    const i = findMessage(history, e.id)
    if (i !== -1) history[i] = toMessage(e)
    return
  }
  if (e.t !== "edit" && e.t !== "react" && e.t !== "delete") return
  applyRoomEvent({ ...emptyRoom(), seq: e.seq - 1, messages: history }, e)
}

export type RoomState = RoomData & {
  doing: Record<string, string | undefined>
  roomId: RoomId
  loaded: boolean
  booted: boolean
  connection: SocketStatus
  patches: RoomPatch[]
  typing: AgentSlug[]
  status: Record<string, AgentState>
  steps: Record<string, RunStep[]>
  live: Record<string, boolean | undefined>
  fetching: Record<string, boolean | undefined>
  history: Message[] | null
}

export type RoomStoreOptions = {
  roomId: RoomId
  warm: Warm
  channel?: UserChannel
  seed?: RoomSeed
  onError?: (error: KikoError) => void
  onBootFailed?: (error: unknown) => void
  schedule?: (run: () => void) => void
  budgetMs?: number
  bootWindow?: number
  now?: () => number
  newId?: () => string
  ttlMs?: number
}

export type RoomSeed = Pick<
  RoomData,
  "messages" | "seq" | "readSeq" | "members" | "tasks" | "files" | "folders" | "asks"
>

export type SearchPage = { results: readonly SearchHit[]; next: number | null }

const ASK_TIMEOUT_MS = 8000
const HISTORY_PAGE = 30
export const NO_MORE = 0
const NO_ANSWER = -1
const TYPING_EVERY_MS = 2000

export type SendOptions = {
  replyTo?: MessageId
  quote?: string
  attachments?: readonly PendingAttachment[]
  local?: readonly LocalAttachment[]
}

export type RoomStore = {
  readonly state: RoomState
  messages(): ViewMessage[]
  tasks(): Task[]
  asks(): HumanAsk[]
  answer(id: string, value: string | HumanAnswers): void
  skip(id: string): void
  members(): Member[]
  files(): FileRef[]
  folders(): string[]
  readSeq(): number
  readonly ready: Promise<void>
  send(text: string, options?: SendOptions): string
  react(messageId: MessageId, emoji: string | null): void
  edit(messageId: MessageId, text: string): void
  remove(messageId: MessageId): void
  markRead(seq: number): void
  typing(): void
  requestSteps(slug: string, after: number, force?: boolean): void
  suspend(): void
  resume(): void
  model(ref: string): void
  task(op: TaskOp): void
  member(op: MemberOp): void
  onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void
  fileOp(op: FileOp): void
  onTaskRefused(listener: (reason: string) => void): () => void
  onFilesRefused(listener: (op: FileOp, reason: string) => void): () => void
  onSendRefused(listener: (reason: string) => void): () => void
  retry(messageId: MessageId): void
  retrySend(clientId: string): void
  discardSend(clientId: string): void
  search(query: string, before?: number, limit?: number): Promise<SearchPage | null>
  jumpTo(seq: number): Promise<boolean>
  live(): void
  loadOlder(limit?: number): Promise<number>
  follow(): void
  hold(): void
  settled(): Promise<void>
  close(): void
}

type RoomMeta = Omit<RoomData, "messages" | "seq" | "agents">
const metaKey = (roomId: RoomId) => `room:${roomId}`

function freeLocal(local: readonly LocalAttachment[] | undefined): void {
  for (const f of local ?? []) if (f.src.startsWith("blob:")) URL.revokeObjectURL(f.src)
}

function defaultSchedule(run: () => void) {
  const MC = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel
  if (!MC) return void setTimeout(run, 0)
  const channel = new MC()
  channel.port1.addEventListener("message", () => {
    channel.port1.close()
    run()
  })
  channel.port1.start()
  channel.port2.postMessage(null)
}

function idle(run: () => void) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number })
    .requestIdleCallback
  if (ric) ric(run, { timeout: 2000 })
  else setTimeout(run, 0)
}

export function createRoomStore(options: RoomStoreOptions): RoomStore {
  const taskRefusalListeners = new Set<(reason: string) => void>()
  const { roomId, warm } = options
  const now = options.now ?? Date.now
  const newId = options.newId ?? (() => crypto.randomUUID())
  const schedule = options.schedule ?? defaultSchedule
  const budget = options.budgetMs ?? 3
  const ttl = options.ttlMs ?? PATCH_TTL_MS

  const [state, setState] = createStore<RoomState>({
    ...(options.seed ? { ...emptyRoom(), ...options.seed } : emptyRoom()),
    roomId,
    loaded: options.seed !== undefined,
    booted: false,
    connection: "closed",
    patches: [],
    typing: [],
    status: {},
    steps: {},
    live: {},
    fetching: {},
    doing: {},
    history: null,
  })

  let socket: RoomChannel | null = null
  const fetchedWindows = new Set<string>()
  const asked = new Map<string, ((answer: unknown) => void)[]>()
  const searchKey = (query: string, before: number | undefined) => `search:${before ?? ""}:${query}`
  const historyKey = (seq: number, before: number, after: number) => `history:${seq}:${before}:${after}`
  let openWaiters: (() => void)[] = []
  let newerBusy = false
  let closed = false
  let lastTypingAt: number | undefined
  let suspended = false
  let queue: RoomEvent[] = []
  let draining = false
  let waiters: (() => void)[] = []
  let expiry: ReturnType<typeof setTimeout> | undefined
  let following = true
  let droppedTail: number | undefined
  const refusalListeners = new Set<(op: MemberOp, reason: MemberRefusal) => void>()
  const fileRefusalListeners = new Set<(op: FileOp, reason: string) => void>()
  const sendRefusalListeners = new Set<(reason: string) => void>()

  const setPatches = (fn: (p: RoomPatch[]) => RoomPatch[]) => setState("patches", (p) => fn(p))

  function transmit(p: RoomPatch) {
    if (p.failed) return
    if (!socket?.send(p.frame)) return
    const sentAt = now()
    setPatches((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
    armExpiry()
  }

  function armExpiry() {
    if (expiry !== undefined) return
    expiry = setTimeout(() => {
      expiry = undefined
      if (state.connection !== "open") return armExpiry()
      setPatches((list) => expire(list, now(), ttl))
      if (state.patches.some((p) => p.sentAt !== undefined && p.frame.t !== "send" && p.frame.t !== "read")) armExpiry()
    }, ttl)
  }

  function act(frame: RoomPatchFrame): string {
    const p: RoomPatch = { clientId: newId(), frame, at: now() }
    setPatches((list) => [...list, p])
    transmit(p)
    return p.clientId
  }

  function dropPatches(next: RoomPatch[]) {
    const kept = new Set(next.map((p) => p.clientId))
    for (const p of raw(state.patches)) {
      if (kept.has(p.clientId) || p.frame.t !== "send") continue
      void removeFromOutbox(warm, p.clientId)
      freeLocal(p.local)
    }
    if (next.length !== state.patches.length) setState("patches", next)
  }

  function writeMeta() {
    const s = raw(state)
    const meta: RoomMeta = {
      readSeq: s.readSeq,
      members: s.members,
      tasks: s.tasks,
      files: s.files,
      folders: s.folders,
      asks: s.asks,
    }
    warm.put("meta", metaKey(roomId), meta)
  }

  function trimWindow(force = false) {
    const n = state.messages.length
    if (n <= MAX_MESSAGES_IN_MEMORY) return
    if (!force && n <= MAX_MESSAGES_IN_MEMORY + WINDOW_SLACK) return
    if (!following) return holdWindow()
    setState("messages", (m) => m.slice(m.length - MAX_MESSAGES_IN_MEMORY))
  }

  async function refillTail() {
    const from = droppedTail
    droppedTail = undefined
    if (from !== undefined) {
      const page = await history(from + 1, 0, HISTORY_PAGE * 4)
      if (page && !closed) setState("messages", (m) => mergeBySeq(m, page))
    }
    trimWindow(true)
  }

  function holdWindow() {
    const held = raw(state.messages)
    if (held.length <= HELD_MESSAGES) return
    droppedTail = held[HELD_MESSAGES - 1]?.seq ?? droppedTail
    setState("messages", (m) => m.slice(0, HELD_MESSAGES))
  }

  async function patchDisk(events: readonly RoomEvent[]) {
    for (const e of events) {
      const ids = eventTargets(e)
      if (ids.length === 0) continue
      const seqs = seqsOf(ids)
      if (seqs.length === 0) continue
      const rows = await Promise.all(seqs.map((seq) => warm.get<Message>("messages", [roomId, seq])))
      for (const m of rows) {
        if (!m) continue
        const change = applyRoomEvent({ ...emptyRoom(), seq: e.seq - 1, messages: [m] }, e)
        if (change?.put) putMessages(warm, roomId, [change.put])
        if (change?.deleted?.length)
          deleteMessages(
            warm,
            roomId,
            change.deleted.map((x) => x.seq),
          )
      }
    }
  }

  function eventTargets(e: RoomEvent): readonly MessageId[] {
    if (e.t === "delete") return e.messageIds
    if (e.t === "edit" || e.t === "react") return [e.messageId]
    return []
  }

  function seqsOf(ids: readonly MessageId[]): number[] {
    return ids.map((id) => messageSeq(roomId, id)).filter((seq) => seq > 0)
  }

  function missedEvent(e: RoomEvent, change: NonNullable<ReturnType<typeof applyRoomEvent>>): boolean {
    return (
      ((e.t === "edit" || e.t === "react") && !change.put) ||
      (e.t === "delete" && (change.deleted?.length ?? 0) < e.messageIds.length)
    )
  }

  function drain() {
    draining = false
    if (closed) return
    const start = performance.now()
    const applied: RoomEvent[] = []
    const puts = new Map<MessageId, Message>()
    const deleted: number[] = []
    let meta = false
    const offWindow: RoomEvent[] = []
    function recordChange(e: RoomEvent, change: NonNullable<ReturnType<typeof applyRoomEvent>>): void {
      if (change.put) puts.set(change.put.id, change.put)
      recordDeleted(change)
      if (change.meta) meta = true
      if (missedEvent(e, change)) offWindow.push(e)
    }
    function recordDeleted(change: NonNullable<ReturnType<typeof applyRoomEvent>>): void {
      for (const m of change.deleted ?? []) {
        puts.delete(m.id)
        deleted.push(m.seq)
      }
    }
    const head = queue[0]
    if (head && head.seq > state.seq + 1) return repair()
    batch(() => {
      setState(
        produce((s) => {
          while (queue.length > 0) {
            const e = queue.shift() as RoomEvent
            const change = applyRoomEvent(s, e)
            if (!change) continue
            applied.push(e)
            recordChange(e, change)
            if (s.history) applyToHistory(s.history, e)
            if (performance.now() - start >= budget) break
          }
        }),
      )
      dropPatches(settleRoom(state.patches, applied, state.seq))
      trimWindow()
    })
    if (offWindow.length) void patchDisk(offWindow).catch(() => {})
    if (applied.length > 0) {
      putMessages(warm, roomId, [...puts.values()])
      deleteMessages(warm, roomId, deleted)
      if (meta) writeMeta()
      setLastSeq(warm, roomId, state.seq)
    }
    if (queue.length > 0) return kick()
    const done = waiters
    waiters = []
    for (const w of done) w()
  }

  function kick() {
    if (draining || closed) return
    draining = true
    schedule(drain)
  }

  function repair() {
    queue = []
    if (closed || suspended) return
    const s = socket
    socket = null
    s?.close()
    openSocket()
  }

  function enqueue(events: readonly RoomEvent[]) {
    if (events.length === 0) return
    queue.push(...events)
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].seq < queue[i - 1].seq) {
        queue.sort((a, b) => a.seq - b.seq)
        break
      }
    }
    kick()
  }

  async function ask<T>(key: string, frame: ClientToRoom): Promise<T | null> {
    let openTimer: ReturnType<typeof setTimeout> | undefined
    if (state.connection !== "open" && !closed && !suspended) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(openTimer)
          openWaiters = openWaiters.filter((w) => w !== done)
          resolve()
        }
        openTimer = setTimeout(done, ASK_TIMEOUT_MS)
        openWaiters.push(done)
      })
    }
    if (closed) return null
    return new Promise<T | null>((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      function finish(answer: unknown) {
        clearTimeout(timer)
        const list = asked.get(key)
        if (list)
          asked.set(
            key,
            list.filter((x) => x !== finish),
          )
        resolve(answer as T | null)
      }
      timer = setTimeout(() => finish(null), ASK_TIMEOUT_MS)
      if (!socket?.send(frame)) return finish(null)
      asked.set(key, [...(asked.get(key) ?? []), finish])
    })
  }

  function answer(key: string, value: unknown) {
    const waiting = asked.get(key)
    asked.delete(key)
    for (const done of waiting ?? []) done(value)
  }

  function history(seq: number, before: number, after: number) {
    return ask<readonly Message[]>(historyKey(seq, before, after), { t: "history", seq, before, after })
  }

  function takeSteps(incoming: readonly RunStep[], live: boolean) {
    if (incoming.length === 0) return
    batch(() => {
      setState(
        produce((s) => {
          for (const step of incoming) {
            s.steps[step.slug] = upsertStep(s.steps[step.slug] ? raw(s.steps[step.slug]) : [], step)
            if (live || step.status === "running") s.live[step.slug] = true
          }
        }),
      )
    })
  }

  function reset(snapshot: RoomSnapshot) {
    queue = queue.filter((e) => e.seq > snapshot.seq)
    const data = fromSnapshot(snapshot)
    const held = raw(state.messages)
    const first = snapshot.messages[0]?.seq
    const heldFirst = held[0]?.seq
    const heldLast = held.at(-1)?.seq
    const overlap =
      heldFirst !== undefined &&
      heldLast !== undefined &&
      first !== undefined &&
      heldFirst <= snapshot.seq &&
      first <= heldLast + 1
    const newer = overlap ? held.filter((m) => m.seq > snapshot.seq) : []
    const messages = overlap ? mergeBySeq(snapshot.messages, newer) : data.messages
    if (!overlap) following = true
    batch(() => {
      setState({ ...data, messages, history: null })
      dropPatches(settleRoom(settleSends(state.patches, snapshot), [], snapshot.seq))
      trimWindow(true)
    })
    takeSteps(snapshot.steps ?? [], true)
    if (first !== undefined) void purgeSnapshotRange(first, snapshot.seq, snapshot.messages)
    putMessages(warm, roomId, messages)
    writeMeta()
    setLastSeq(warm, roomId, snapshot.seq)
    kick()
  }

  async function purgeSnapshotRange(from: number, to: number, keep: readonly Message[]): Promise<void> {
    const live = new Set(keep.map((m) => m.seq))
    const rows = await warm.getAll<Message>("messages", roomRange(roomId, from, to))
    const stale = rows.map((m) => m.seq).filter((seq) => !live.has(seq))
    if (stale.length) deleteMessages(warm, roomId, stale)
  }

  const handlers: { [K in RoomToClient["t"]]: (f: Extract<RoomToClient, { t: K }>) => void } = {
    events: (f) => enqueue(f.events),
    ack: (f) => {
      void removeFromOutbox(warm, f.clientId)
      batch(() => {
        setPatches((list) => list.map((p) => (p.clientId === f.clientId ? { ...p, ack: { id: f.id, seq: f.seq } } : p)))
        dropPatches(settleRoom(state.patches, [], state.seq))
      })
    },
    reset: (f) => reset(f.snapshot),
    typing: (f) => setState("typing", [...f.who]),
    status: ({ t: _t, ...f }) =>
      batch(() => {
        setState("status", f.slug, f.state)
        setState("doing", f.slug, f.state === "idle" ? undefined : f.doing)
        if (f.state === "idle") setState("live", f.slug, undefined)
        setState(produce((s) => applyStatus(s, f)))
      }),
    step: (f) => takeSteps([f.step], false),
    steps: (f) => {
      const key = windowKey(f.slug, f.after)
      fetchedWindows.add(key)
      setState("fetching", key, undefined)
      takeSteps(f.steps, false)
    },
    search: (f) => answer(searchKey(f.query, f.before), { results: f.results, next: f.next }),
    history: (f) => answer(historyKey(f.seq, f.before, f.after), f.messages),
    draft: () => {},
    member_refused: (f) => {
      const refused = (p: RoomPatch) =>
        p.frame.t === "member" && p.frame.op.op === f.op.op && p.frame.op.slug === f.op.slug
      dropPatches(raw(state.patches).filter((p) => !refused(p)))
      for (const listener of refusalListeners) listener(f.op, f.reason)
    },
    send_refused: (f) => {
      void removeFromOutbox(warm, f.clientId)
      setPatches((list) => list.map((p) => (p.clientId === f.clientId ? { ...p, failed: true, reason: f.reason } : p)))
      for (const listener of sendRefusalListeners) listener(f.reason)
    },
    error: (f) => options.onError?.(f.error),
    task_refused: (f) => {
      dropPatches(raw(state.patches).filter((p) => !(p.frame.t === "task" && p.frame.op.id === f.op.id)))
      for (const listener of taskRefusalListeners) listener(f.reason)
    },
    files_refused: (f) => {
      const same = (p: RoomPatch) => p.frame.t === "files" && JSON.stringify(p.frame.op) === JSON.stringify(f.op)
      dropPatches(raw(state.patches).filter((p) => !same(p)))
      for (const listener of fileRefusalListeners) listener(f.op, f.reason)
    },
  }

  function onFrame(frame: RoomToClient) {
    const handle = handlers[frame.t] as ((f: RoomToClient) => void) | undefined
    handle?.(frame)
  }

  function onOpen() {
    const waiting = openWaiters
    openWaiters = []
    for (const w of waiting) w()
    for (const p of Array.from(raw(state.patches))) if (!p.ack) transmit(p)
    retryFailedUploads()
  }

  function onStatus(connection: SocketStatus) {
    setState("connection", connection)
    if (connection !== "open") {
      setState({ typing: [], status: {}, agents: [], live: {}, fetching: {}, doing: {} })
      fetchedWindows.clear()
    }
  }

  async function boot() {
    const [messages, lastSeq, meta, pending] = await Promise.all([
      newestMessages(warm, roomId, options.bootWindow),
      getLastSeq(warm, roomId),
      warm.get<RoomMeta>("meta", metaKey(roomId)),
      outbox(warm, roomId),
    ])
    if (closed) return
    batch(() => {
      setState(
        produce((s) => {
          const disk = lastSeq > 0 && (!s.loaded || lastSeq > s.seq)
          if (disk) {
            s.messages = messages
            s.seq = lastSeq
          }
          if (meta) {
            s.readSeq = Math.max(s.readSeq, meta.readSeq)
            s.members = [...meta.members]
            s.tasks = [...meta.tasks]
            s.asks = [...meta.asks]
            s.files = [...meta.files]
            s.folders = [...meta.folders]
          }
          s.loaded = true
          s.booted = true
          const have = new Set(s.patches.map((p) => p.clientId))
          const restored = pending
            .filter((i) => !have.has(i.frame.clientId))
            .map((i): RoomPatch => ({ clientId: i.frame.clientId, frame: i.frame, at: i.createdAt }))
          s.patches = settleSends([...restored, ...s.patches], { messages: s.messages, seq: s.seq })
        }),
      )
    })
    if (!suspended) openSocket()
  }

  async function bootSafely(): Promise<void> {
    try {
      await boot()
    } catch (error) {
      if (closed) return
      options.onBootFailed?.(error)
      setState({ loaded: true, booted: true })
      if (!suspended) openSocket()
    }
  }

  function openSocket() {
    socket = (options.channel ?? userChannel).room({
      roomId,
      lastSeq: () => state.seq,
      onOpen,
      onFrame,
      onStatus,
    })
  }

  const ready = bootSafely()

  async function loadNewer() {
    const shown = state.history
    if (!shown || newerBusy) return
    newerBusy = true
    try {
      const from = (shown.at(-1)?.seq ?? 0) + 1
      const page = await history(from, 0, HISTORY_PAGE * 2)
      if (!page || closed || state.history !== shown) return
      const live = raw(state.messages)
      const reaches = page.length < HISTORY_PAGE * 2 || live.length === 0 || page.some((m) => m.seq >= live[0]!.seq)
      if (reaches) setState({ messages: mergeBySeq(mergeBySeq(raw(shown), page), live), history: null })
      else setState("history", mergeBySeq(raw(shown), page))
    } finally {
      newerBusy = false
    }
  }

  return {
    state,
    messages: () => overlayMessages(state.history ?? state.messages, state.history ? [] : state.patches),
    tasks: () => overlayTasks(state.tasks, state.patches),
    asks: () =>
      state.asks.filter(
        (a) => !state.patches.some((p) => (p.frame.t === "answer" || p.frame.t === "skip") && p.frame.id === a.id),
      ),
    answer(id, value) {
      const ask = state.asks.find((a) => a.id === id)
      if (
        !ask ||
        !humanAnswerText(ask, value) ||
        state.patches.some((p) => (p.frame.t === "answer" || p.frame.t === "skip") && p.frame.id === id)
      )
        return
      if (state.history) setState("history", null)
      const p: RoomPatch = {
        clientId: `answer:${id}`,
        frame: { t: "answer", id, value: typeof value === "string" ? value.trim() : value },
        at: now(),
        ask: { ...ask },
      }
      setPatches((list) => [...list, p])
      transmit(p)
    },
    skip(id) {
      if (state.asks.some((a) => a.id === id)) act({ t: "skip", id })
    },
    members: () => overlayMembers(state.members, state.patches),
    files: () => overlayFiles(state.files, state.patches, state.folders),
    folders: () => overlayFolders(state.folders, state.patches),
    readSeq: () => overlayReadSeq(state.readSeq, state.patches),
    ready,
    send(text, opts = {}) {
      lastTypingAt = Number.NEGATIVE_INFINITY
      if (state.history) setState("history", null)
      const clientId = newId()
      const frame: RoomPatchFrame = { t: "send", clientId, text }
      if (opts.replyTo) frame.replyTo = opts.replyTo
      if (opts.replyTo && opts.quote) frame.quote = opts.quote
      if (opts.attachments?.length) frame.attachments = opts.attachments
      const p: RoomPatch = { clientId, frame, at: now(), ...(opts.local?.length ? { local: opts.local } : {}) }
      void addToOutbox(warm, { roomId, frame, createdAt: p.at })
      setPatches((list) => [...list, p])
      transmit(p)
      return clientId
    },
    model(ref) {
      socket?.send({ t: "model", ref })
    },
    react: (messageId, emoji) => void act({ t: "react", messageId, emoji }),
    edit: (messageId, text) => void act({ t: "edit", messageId, text }),
    remove: (messageId) => void act({ t: "delete", messageId }),
    markRead(seq) {
      if (seq <= overlayReadSeq(state.readSeq, state.patches)) return
      setPatches((list) => list.filter((p) => p.frame.t !== "read"))
      act({ t: "read", seq })
    },
    typing() {
      const t = now()
      if (lastTypingAt !== undefined && t - lastTypingAt < TYPING_EVERY_MS) return
      if (socket?.send({ t: "typing" })) lastTypingAt = t
    },
    requestSteps(slug, after, force = false) {
      const key = windowKey(slug, after)
      if (state.fetching[key] || (!force && fetchedWindows.has(key))) return
      if (!socket?.send({ t: "steps", slug: slug as AgentSlug, after })) return
      setState("fetching", key, true)
      setTimeout(() => {
        if (!state.fetching[key]) return
        setState("fetching", key, undefined)
      }, ASK_TIMEOUT_MS)
    },
    suspend() {
      suspended = true
      socket?.close()
      socket = null
    },
    resume() {
      if (!suspended) return
      suspended = false
      if (!closed && state.loaded && !socket) openSocket()
    },
    task: (op) => void act({ t: "task", op }),
    member: (op) => void act({ t: "member", op }),
    onMemberRefused(listener) {
      refusalListeners.add(listener)
      return () => refusalListeners.delete(listener)
    },
    fileOp: (op) => void act({ t: "files", op }),
    onTaskRefused(listener) {
      taskRefusalListeners.add(listener)
      return () => taskRefusalListeners.delete(listener)
    },
    onFilesRefused(listener) {
      fileRefusalListeners.add(listener)
      return () => fileRefusalListeners.delete(listener)
    },
    retry(messageId) {
      socket?.send({ t: "retry", messageId })
    },
    retrySend(clientId) {
      const patch = raw(state.patches).find((p) => p.clientId === clientId && p.frame.t === "send")
      if (!patch) return
      setPatches((list) =>
        list.map((p) => (p.clientId === clientId ? { clientId: p.clientId, frame: p.frame, at: p.at } : p)),
      )
      transmit({ clientId: patch.clientId, frame: patch.frame, at: patch.at })
    },
    discardSend(clientId) {
      void removeFromOutbox(warm, clientId)
      for (const p of raw(state.patches)) if (p.clientId === clientId) freeLocal(p.local)
      dropPatches(raw(state.patches).filter((p) => p.clientId !== clientId))
    },
    onSendRefused(listener) {
      sendRefusalListeners.add(listener)
      return () => sendRefusalListeners.delete(listener)
    },
    search(query, before, limit) {
      return ask<SearchPage>(searchKey(query, before), {
        t: "search",
        query,
        ...(before !== undefined ? { before } : {}),
        ...(limit !== undefined ? { limit } : {}),
      })
    },
    async jumpTo(seq) {
      const held = (list: readonly Message[] | null) => !!list && raw(list).some((m) => m.seq === seq)
      if (held(state.history)) return true
      if (held(state.messages)) {
        if (state.history) setState("history", null)
        return true
      }
      const page = await history(seq, HISTORY_PAGE, HISTORY_PAGE)
      if (!page || closed || !page.some((m) => m.seq === seq)) return false
      const live = raw(state.messages)
      following = false
      if (live.length === 0 || page.at(-1)!.seq >= live[0]!.seq)
        setState({ messages: mergeBySeq(page, live), history: null })
      else setState("history", [...page])
      return true
    },
    live() {
      if (state.history) setState("history", null)
    },
    async loadOlder(limit = 50) {
      const shown = state.history ?? state.messages
      const oldest = shown[0]?.seq ?? state.seq + 1
      const older = state.history ? [] : await messagesBefore(warm, roomId, oldest, limit)
      if (closed) return NO_MORE
      if (older.length) {
        following = false
        setState("messages", (m) => [...older.filter((o) => o.seq < (m[0]?.seq ?? Infinity)), ...m])
        return older.length
      }
      if (oldest <= 1) return NO_MORE
      const answer = await history(oldest, Math.min(limit, HISTORY_PAGE * 2), 0)
      if (closed) return NO_MORE
      if (answer === null) return NO_ANSWER
      const page = answer
      if (!page.length) return NO_MORE
      if ((state.history ?? state.messages)[0]?.seq !== oldest) return NO_ANSWER
      following = false
      if (state.history) setState("history", (h) => mergeBySeq(page, h ?? []))
      else setState("messages", (m) => mergeBySeq(page, m))
      return page.length
    },
    follow() {
      if (state.history) {
        void loadNewer()
        return
      }
      following = true
      if (droppedTail !== undefined) void refillTail()
      else trimWindow(true)
    },
    hold() {
      following = false
    },
    settled() {
      if (queue.length === 0 && !draining) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },
    close() {
      closed = true
      for (const p of raw(state.patches)) freeLocal(p.local)
      const trimTo = state.seq - KEEP_ON_DISK
      idle(() => dropBefore(warm, roomId, trimTo))
      for (const waiting of asked.values()) for (const done of waiting) done(null)
      asked.clear()
      for (const w of openWaiters) w()
      openWaiters = []
      if (expiry !== undefined) clearTimeout(expiry)
      socket?.close()
      for (const w of waiters) w()
      waiters = []
    },
  }
}
