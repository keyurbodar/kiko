import type {
  OwnerToClient,
  Agent,
  AgentModel,
  AgentSlug,
  Chat,
  ChatOp,
  ClientToUser,
  FileOp,
  FileRef,
  KikoError,
  RoomId,
  RowKind,
  ThinkingLevel,
  UserEvent,
  UserRows,
  UserSnapshot,
  UserToClient,
} from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import {
  allAgentModels,
  allAgents,
  allChats,
  getHome,
  getPendingChats,
  getRows,
  getUserSeq,
  putAgentModels,
  putAgents,
  putChats,
  putHome,
  putPendingChats,
  putRows,
  removeChat,
  replaceChats,
  setUserSeq,
} from "../warm/chats"
import type { Warm } from "../warm/db"
import {
  expire,
  overlayChats,
  overlayFiles,
  overlayFolders,
  PATCH_TTL_MS,
  type RoomPatch,
  roomConfirmedBy,
  settleUser,
  type UserPatch,
} from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"
import { type UserChannelHost, userChannel } from "./socket"
import { kikoPlaceholder } from "../lib/chats"

type AgentModelFrame = Extract<ClientToUser, { t: "agent_model" }>
import { setFileToken } from "../lib/file-token"
import { APP_VERSION, backendSkew, type Skew } from "../lib/version-skew"

export type Home = { files: FileRef[]; folders: string[] }
export type RowData = { [K in RowKind]: UserRows[K][] }
const emptyRows = (): RowData => ({ routine: [], soul: [], provider: [] })
export type UserData = { seq: number; chats: Chat[]; agents: Agent[]; home: Home; rows: RowData }

type PendingRow = { kind: RowKind; id: string; row: UserRows[RowKind] | null; at: number }
const rowKey = (kind: RowKind, id: string) => `${kind}:${id}`
const PENDING_ROW_MS = 10_000
const ROW_SETTLE_MS = 2_500
const ROW_SETTLE_TRIES = 20

function applyUserEvent(data: UserData, e: UserEvent): boolean {
  const projection = e.t === "chat" && e.projection === true
  if (projection ? e.seq < data.seq : e.seq <= data.seq) return false
  if (!claimed(data, e)) return false
  if (!projection) data.seq = e.seq
  return true
}

function claimed(data: UserData, e: UserEvent): boolean {
  return applyHomeEvent(data, e) || applyDirectoryEvent(data, e) || applyChatEvent(data, e)
}

function applyHomeEvent(data: UserData, e: UserEvent): boolean {
  if (e.t === "theme" || e.t === "agent_model") return true
  if (e.t === "file") {
    data.home.files = data.home.files.filter((x) => x.name !== e.file.name || x.id === e.file.id)
    const i = data.home.files.findIndex((x) => x.id === e.file.id)
    if (i === -1) data.home.files.push(e.file)
    else data.home.files[i] = e.file
    return true
  }
  if (e.t === "file_removed") {
    data.home.files = data.home.files.filter((x) => !e.ids.includes(x.id))
    return true
  }
  if (e.t === "folders") {
    data.home.folders = [...e.folders]
    return true
  }
  return false
}

function applyDirectoryEvent(data: UserData, e: UserEvent): boolean {
  if (e.t === "row") {
    const list = data.rows[e.kind] as { id: string }[]
    const i = list.findIndex((r) => r.id === e.row.id)
    if (i === -1) list.push(e.row)
    else list[i] = e.row
    return true
  }
  if (e.t === "row_removed") {
    ;(data.rows as Record<RowKind, { id: string }[]>)[e.kind] = data.rows[e.kind].filter((r) => r.id !== e.id)
    return true
  }
  if (e.t === "agent_removed") {
    data.agents = data.agents.filter((a) => a.id !== e.id)
    return true
  }
  if (e.t === "agent") {
    const i = data.agents.findIndex((a) => a.id === e.agent.id)
    if (i === -1) data.agents.push(e.agent)
    else data.agents[i] = e.agent
    return true
  }
  return false
}

function applyChatEvent(data: UserData, e: UserEvent): boolean {
  if (e.t !== "chat" && e.t !== "chat_removed") return false
  const i = data.chats.findIndex((c) => c.roomId === (e.t === "chat" ? e.chat.roomId : e.roomId))
  if (e.t === "chat") {
    if (i === -1) data.chats.push(e.chat)
    else data.chats[i] = e.chat
  } else if (i !== -1) data.chats.splice(i, 1)
  return true
}

import { clampThinking, defaultThinking, newRoomId, PROTOCOL, sameAgentChat } from "@kiko/protocol"

const clientBuild = () => ({ version: APP_VERSION, protocol: PROTOCOL })

export type UserState = UserData & {
  loaded: boolean
  connection: SocketStatus
  patches: UserPatch[]
  pendingHome: RoomPatch[]
  agentModels: Record<string, AgentModel>
  pendingModels: Record<string, AgentModel>
  theme?: string | null
  synced: boolean
  lastChat: RoomId | null
  refused: Record<string, RoomId>
  gone: Record<string, true>
  pendingRows: Record<string, PendingRow>
  typing: Record<string, readonly string[]>
  skew?: Skew
  backendVersion?: string
}

export type UserStoreOptions = {
  warm: Warm
  url: string
  connect?: Connect
  backoff?: Backoff
  now?: () => number
  newId?: () => string
  ttlMs?: number
  channel?: UserChannelHost
  onError?: (error: KikoError, roomId?: RoomId) => void
}

export type UserStore = {
  readonly state: UserState
  chats(): Chat[]
  readonly ready: Promise<void>
  agents(): Agent[]
  rows<K extends RowKind>(kind: K): UserRows[K][]
  editRow<K extends RowKind>(
    kind: K,
    id: string,
    next: UserRows[K] | null,
    send: () => Promise<boolean>,
  ): Promise<boolean>
  agentModel(slug: string): AgentModel | undefined
  setAgentModel(
    slug: AgentSlug,
    pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[]; roomId?: RoomId },
  ): void
  createChat(title: string, agents?: readonly string[]): RoomId
  addAgentChat(agent: Agent, roomId: RoomId): () => void
  open(roomId: RoomId): void

  rename(roomId: RoomId, title: string): void
  pin(roomId: RoomId, pinned: boolean): void
  mute(roomId: RoomId, muted: boolean): void
  setPrivate(roomId: RoomId, value: boolean): void
  remove(roomId: RoomId): void
  homeFiles(): FileRef[]
  homeFolders(): string[]
  homeOp(op: FileOp): void
  onHomeRefused(listener: (op: FileOp, reason: string) => void): () => void
  close(): void
}

const OPEN_DEBOUNCE_MS = 2_000

export function createUserStore(options: UserStoreOptions): UserStore {
  const { warm } = options
  const channel = options.channel ?? userChannel
  const now = options.now ?? Date.now
  const newId = options.newId ?? (() => crypto.randomUUID())
  const ttl = options.ttlMs ?? PATCH_TTL_MS

  const [state, setState] = createStore<UserState>({
    seq: 0,
    chats: [],
    agents: [],
    home: { files: [], folders: [] },
    rows: emptyRows(),
    pendingRows: {},
    loaded: false,
    connection: "closed",
    patches: [],
    pendingHome: [],
    agentModels: {},
    pendingModels: {},
    synced: false,
    lastChat: null,
    refused: {},
    typing: {},
    gone: {},
  })
  const homeRefusals = new Set<(op: FileOp, reason: string) => void>()
  let opening: ReturnType<typeof setTimeout> | undefined
  let socket: SyncSocket | null = null
  let closed = false
  let detach = () => {}
  let expiry: ReturnType<typeof setTimeout> | undefined
  let awaitingHello = false
  let greetingTimer: ReturnType<typeof setTimeout> | undefined
  const GREETING_MS = 15_000
  const unsentModels = new Map<string, AgentModelFrame>()
  const unsentHome: FileOp[] = []

  function dropModel(slug: string): void {
    setState(
      "pendingModels",
      produce((map) => {
        delete map[slug]
      }),
    )
  }

  function dropTyping(roomId: RoomId): void {
    setState(
      "typing",
      produce((map) => {
        delete map[roomId]
      }),
    )
  }

  function forgetProviderModels(provider: string): void {
    const gone = (ref: string | undefined) => ref !== undefined && ref.split("/")[0] === provider
    setState(
      "pendingModels",
      produce((models) => {
        for (const slug in models) if (gone(models[slug]?.model)) delete models[slug]
      }),
    )
    for (const [slug, frame] of unsentModels) if (gone(frame.ref)) unsentModels.delete(slug)
  }

  function expireHome(op: FileOp, at: number): void {
    if (closed) return
    setState("pendingHome", (list) => list.filter((p) => p.at !== at))
    const same = JSON.stringify(op)
    for (let i = unsentHome.length - 1; i >= 0; i--) if (JSON.stringify(unsentHome[i]) === same) unsentHome.splice(i, 1)
  }

  function armRowSettle(key: string, at: number, mine: () => boolean): void {
    const check = (tries: number) => {
      if (closed || !mine()) return
      if (tries <= 0)
        return setState(
          "pendingRows",
          produce((p) => void delete p[key]),
        )
      setTimeout(() => check(tries - 1), ROW_SETTLE_MS)
    }
    setTimeout(() => check(ROW_SETTLE_TRIES), ROW_SETTLE_MS)
  }

  function armModelExpiry(slug: string, frame: AgentModelFrame): void {
    setTimeout(() => {
      if (unsentModels.get(slug) !== frame) return
      unsentModels.delete(slug)
      dropModel(slug)
    }, PENDING_ROW_MS)
  }

  function setPatches(next: UserPatch[] | ((list: UserPatch[]) => UserPatch[])) {
    setState("patches", next)
    putPendingChats(
      warm,
      unwrap(state.patches).map(({ clientId, op, at }) => ({ clientId, op, at })),
    )
  }

  function transmit(p: UserPatch) {
    if (!socket?.send({ t: "chat", op: p.op })) return
    const sentAt = now()
    setState("patches", (list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
    if (expiry === undefined) armExpiry()
  }

  function armExpiry() {
    expiry = setTimeout(() => {
      expiry = undefined
      if (closed) return
      setPatches((list) => expire(list, now(), ttl))
      if (state.patches.some((p) => p.sentAt !== undefined)) armExpiry()
    }, ttl)
  }

  function act(op: ChatOp) {
    const p: UserPatch = { clientId: newId(), op, at: now() }
    setPatches((list) => [...list, p])
    transmit(p)
  }

  function applyEvents(events: readonly UserEvent[]) {
    const sorted = [...events].sort((a, b) => a.seq - b.seq)
    const applied: UserEvent[] = []
    batch(() => {
      setState(
        produce((s) => {
          for (const e of sorted) {
            if (!applyUserEvent(s, e)) continue
            applied.push(e)
            if (e.t === "agent_removed") s.gone[e.slug] = true
            if (e.t === "row" || e.t === "row_removed")
              delete s.pendingRows[rowKey(e.kind, e.t === "row" ? e.row.id : e.id)]
          }
        }),
      )
      const next = settleUser(state.patches, applied)
      if (next.length !== state.patches.length) setPatches(next)
      for (const e of applied) {
        if (e.t === "agent_removed") {
          setState(
            "agentModels",
            produce((models) => {
              delete models[e.slug]
            }),
          )
          dropModel(e.slug)
          unsentModels.delete(e.slug)
        } else if (e.t === "theme") setState("theme", e.theme)
        else if (e.t === "row_removed" && e.kind === "provider") forgetProviderModels(e.id)
        else if (e.t === "agent_model") {
          setState("agentModels", e.slug, {
            model: e.model,
            name: e.name,
            thinking: e.thinking,
            thinkingLevels: e.thinkingLevels,
          })
          dropModel(e.slug)
          unsentModels.delete(e.slug)
        }
      }
      const home = state.pendingHome.filter((p) => !applied.some((e) => roomConfirmedBy(p, e as never)))
      if (home.length !== state.pendingHome.length) setState("pendingHome", home)
    })
    for (const e of applied) {
      if (e.t === "chat") putChats(warm, [e.chat])
      else if (e.t === "chat_removed") removeChat(warm, e.roomId)
    }
    if (applied.some((e) => e.t === "agent" || e.t === "agent_removed")) putAgents(warm, unwrap(state.agents))
    if (applied.some((e) => e.t === "agent_model" || e.t === "agent_removed"))
      putAgentModels(warm, unwrap(state.agentModels))
    if (applied.some((e) => e.t === "file" || e.t === "file_removed" || e.t === "folders"))
      putHome(warm, unwrap(state.home))
    const kinds = new Set(applied.flatMap((e) => (e.t === "row" || e.t === "row_removed" ? [e.kind] : [])))
    if (kinds.size) putRows(warm, unwrap(state.rows), [...kinds])
    if (applied.length) setUserSeq(warm, state.seq)
  }

  function reset(snapshot: UserSnapshot) {
    const agents = [...(snapshot.agents ?? [])]
    const home = { files: [...snapshot.home.files], folders: [...snapshot.home.folders] }
    const rows = { ...emptyRows(), ...structuredClone(snapshot.rows ?? {}) } as RowData
    setState({
      seq: snapshot.seq,
      chats: [...snapshot.chats],
      agents,
      home,
      rows,
      lastChat: snapshot.lastChat ?? null,
      gone: {},
      refused: {},
      pendingRows: {},
    })
    putRows(warm, rows)
    if (snapshot.theme !== undefined) setState("theme", snapshot.theme)
    const agentModels = { ...snapshot.agentModels }
    setState({
      agentModels,
      pendingModels: Object.fromEntries(
        Object.entries(unwrap(state.pendingModels)).filter(([slug]) => unsentModels.has(slug)),
      ),
    })
    putAgentModels(warm, agentModels)
    replaceChats(warm, snapshot.chats, snapshot.seq)
    putAgents(warm, agents)
    putHome(warm, home)
  }

  function onFrame(frame: UserToClient) {
    channel.deliver(frame)
    if (frame.t === "events" || frame.t === "reset") {
      if (frame.fileToken) setFileToken(frame.fileToken)
      if (awaitingHello) {
        awaitingHello = false
        clearTimeout(greetingTimer)
        greetingTimer = undefined
        setState({ skew: backendSkew(clientBuild(), frame), backendVersion: frame.version })
      }
      if (frame.t === "events") applyEvents(frame.events)
      else reset(frame.snapshot)
      if (!state.synced) setState("synced", true)
    } else if (frame.t === "chat_refused") {
      batch(() => {
        setState("refused", frame.roomId, frame.existing)
        setPatches((list) => list.filter((p) => p.op.roomId !== frame.roomId))
      })
    } else if (frame.t === "model_refused") {
      unsentModels.delete(frame.slug)
      dropModel(frame.slug)
      options.onError?.({ code: "model", message: frame.message, action: "open_models" })
    } else if (frame.t === "error") options.onError?.(frame.error, frame.roomId)
    else if (frame.t === "typing") {
      if (frame.names.length) setState("typing", frame.roomId, [...frame.names])
      else dropTyping(frame.roomId)
    } else if (frame.t === "home_refused") {
      const same = JSON.stringify(frame.op)
      setState("pendingHome", (list) =>
        list.filter((p) => p.frame.t !== "files" || JSON.stringify(p.frame.op) !== same),
      )
      for (let i = unsentHome.length - 1; i >= 0; i--)
        if (JSON.stringify(unsentHome[i]) === same) unsentHome.splice(i, 1)
      for (const listener of homeRefusals) listener(frame.op, frame.reason)
    }
  }

  async function boot() {
    const [chats, seq, agents, home, pending, agentModels, rows] = await Promise.all([
      allChats(warm),
      getUserSeq(warm),
      allAgents(warm),
      getHome(warm),
      getPendingChats(warm),
      allAgentModels(warm),
      getRows(warm),
    ])
    if (closed) return
    const first = chats.length ? chats : [kikoPlaceholder(now())]
    setState({
      chats: first,
      seq: home && rows ? seq : 0,
      agents,
      agentModels,
      home: home ?? { files: [], folders: [] },
      rows: { ...emptyRows(), ...rows },
      patches: [...pending, ...state.patches],
      loaded: true,
    })
    socket = createSyncSocket<OwnerToClient>({
      url: options.url,
      connect: options.connect,
      backoff: options.backoff,
      hello: () => {
        awaitingHello = true
        clearTimeout(greetingTimer)
        greetingTimer = setTimeout(() => {
          if (awaitingHello && !closed) socket?.reconnect()
        }, GREETING_MS)
        return { t: "hello", lastSeq: state.seq }
      },
      onOpen: () => {
        for (const p of Array.from(unwrap(state.patches))) transmit(p)
        for (const op of unsentHome.splice(0)) socket?.send({ t: "home", op })
        for (const [slug, frame] of Array.from(unsentModels)) if (socket?.send(frame)) armModelExpiry(slug, frame)
        channel.opened()
      },
      onFrame: (frame) => {
        if (frame.t === "room") channel.deliver(frame)
        else onFrame(frame)
      },
      onStatus: (c) => {
        channel.status(c)
        setState(c === "open" ? { connection: c } : { connection: c, typing: {} })
      },
    })
    const own = socket
    detach = channel.attach((frame) => own.send(frame))
  }

  const ready = boot()

  return {
    state,
    chats: () => overlayChats(state.chats, state.patches),
    ready,
    agents: () => state.agents,
    rows<K extends RowKind>(kind: K): UserRows[K][] {
      const list = state.rows[kind] as UserRows[K][]
      const pending = Object.values(state.pendingRows).filter((p) => p.kind === kind)
      if (!pending.length) return list
      const out = list.flatMap((r) => {
        const p = state.pendingRows[rowKey(kind, r.id)]
        return !p ? [r] : p.row ? [p.row as UserRows[K]] : []
      })
      for (const p of pending) if (p.row && !list.some((r) => r.id === p.id)) out.push(p.row as UserRows[K])
      return out
    },
    async editRow(kind, id, next, send) {
      const key = rowKey(kind, id)
      const at = now()
      setState("pendingRows", key, { kind, id, row: next, at })
      const ok = await send().catch(() => false)
      const mine = () => state.pendingRows[key]?.at === at
      if (!ok) {
        if (mine())
          setState(
            "pendingRows",
            produce((p) => void delete p[key]),
          )
        return false
      }
      armRowSettle(key, at, mine)
      return true
    },
    agentModel: (slug) => {
      const pick = state.pendingModels[slug] ?? state.agentModels[slug]
      if (!pick || !state.synced) return pick
      const provider = pick.model.split("/")[0] ?? ""
      const providers = state.rows.provider as readonly { id: string }[]
      return !provider || providers.some((p) => p.id === provider) ? pick : undefined
    },
    setAgentModel(slug, { ref, thinking, levels, roomId }) {
      const current = state.pendingModels[slug] ?? state.agentModels[slug]
      const nextLevels = levels ?? current?.thinkingLevels
      const model = ref ?? current?.model
      if (model && nextLevels)
        setState("pendingModels", slug, {
          model,
          thinking: clampThinking(nextLevels, thinking ?? current?.thinking ?? defaultThinking(nextLevels)),
          thinkingLevels: nextLevels,
        })
      const frame: AgentModelFrame = {
        ...unsentModels.get(slug),
        t: "agent_model",
        slug,
        ...(ref ? { ref } : {}),
        ...(thinking ? { thinking } : {}),
        ...(roomId ? { roomId } : {}),
      }
      unsentModels.set(slug, frame)
      if (socket?.send(frame)) armModelExpiry(slug, frame)
    },
    createChat(title, agents) {
      const existing = agents?.length ? sameAgentChat(overlayChats(state.chats, state.patches), agents) : null
      if (existing) return existing.roomId
      const roomId = newRoomId()
      act({ op: "create", roomId, title, ...(agents?.length ? { agents } : {}) })
      return roomId
    },
    addAgentChat(agent, roomId) {
      const chat: Chat = {
        roomId,
        title: agent.name,
        pinned: false,
        muted: false,
        lastSeq: 0,
        lastPreview: "",
        unread: 0,
        updatedAt: now(),
        agents: [agent.id],
      }
      batch(() => {
        setState("agents", (list) => [...list, agent])
        setState("chats", (list) => [...list, chat])
      })
      return () =>
        batch(() => {
          setState("agents", (list) => list.filter((a) => a.id !== agent.id))
          setState("chats", (list) => list.filter((c) => c.roomId !== roomId))
        })
    },
    open(roomId) {
      if (opening !== undefined) clearTimeout(opening)
      opening = setTimeout(() => {
        opening = undefined
        socket?.send({ t: "open", roomId })
      }, OPEN_DEBOUNCE_MS)
    },
    rename: (roomId, title) => act({ op: "rename", roomId, title }),
    pin: (roomId, pinned) => act({ op: "pin", roomId, pinned }),
    mute: (roomId, muted) => act({ op: "mute", roomId, muted }),
    setPrivate: (roomId, value) => act({ op: "private", roomId, private: value }),
    remove: (roomId) => act({ op: "delete", roomId }),
    homeFiles: () => overlayFiles(state.home.files, state.pendingHome, state.home.folders),
    homeFolders: () => overlayFolders(state.home.folders, state.pendingHome),
    homeOp(op) {
      const at = now()
      setState("pendingHome", (list) => [...list, { clientId: newId(), at, frame: { t: "files", op } }])
      if (!socket?.send({ t: "home", op })) unsentHome.push(op)
      setTimeout(() => expireHome(op, at), PENDING_ROW_MS * 6)
    },
    onHomeRefused(listener) {
      homeRefusals.add(listener)
      return () => homeRefusals.delete(listener)
    },
    close() {
      closed = true
      clearTimeout(greetingTimer)
      if (expiry !== undefined) clearTimeout(expiry)
      detach()
      if (opening !== undefined) clearTimeout(opening)
      socket?.close()
    },
  }
}
