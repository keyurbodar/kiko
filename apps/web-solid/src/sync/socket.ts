import type {
  ClientToOwner,
  ClientToRoom,
  OwnerToClient,
  RoomId,
  RoomToClient,
  ClientToUser,
  UserToClient,
} from "@kiko/protocol"
import { socketProtocols } from "../lib/api"

const PING = "ping"

export type SocketLike = {
  binaryType?: string
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "open", listener: (event: unknown) => void): void
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void
  addEventListener(type: "close", listener: (event: unknown) => void): void
  addEventListener(type: "error", listener: (event: unknown) => void): void
}

export type Connect = (url: string) => SocketLike

export const browserConnect: Connect = (url) => {
  const socket = new WebSocket(url, socketProtocols())
  socket.binaryType = "arraybuffer"
  return socket as unknown as SocketLike
}

export type SocketStatus = "connecting" | "open" | "closed" | "blocked"

const FINAL_CLOSE = new Set([1002, 1008])

const SLOW_RETRY_MS = 60_000

const closeIsFinal = (event: unknown): boolean => {
  const code = (event as { code?: unknown } | null)?.code
  return typeof code === "number" && FINAL_CLOSE.has(code)
}

export type Backoff = {
  baseMs?: number
  maxMs?: number
}

export type SyncSocketOptions<In> = {
  url: string
  connect?: Connect
  hello: () => { t: "hello"; lastSeq: number }
  onOpen?: () => void
  onFrame: (frame: In) => void
  onBinary?: (data: ArrayBuffer) => void
  onStatus?: (status: SocketStatus) => void
  backoff?: Backoff
  random?: () => number
  pingMs?: number
  pongMs?: number
}

export type SyncSocket = {
  readonly status: SocketStatus
  send<F extends { t: string }>(frame: F): boolean
  reconnect(): void
  close(): void
}

function backoffDelay(attempt: number, baseMs = 250, maxMs = 10_000, random = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30))
  return Math.round(ceiling / 2 + (ceiling / 2) * random())
}

function parseFrame<In>(data: unknown): In | null {
  if (typeof data !== "string") return null
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value !== "object" || value === null || typeof (value as { t?: unknown }).t !== "string") return null
    return value as In
  } catch {
    return null
  }
}

export function createSyncSocket<In>(options: SyncSocketOptions<In>): SyncSocket {
  const connect = options.connect ?? browserConnect
  const random = options.random ?? Math.random
  let status: SocketStatus = "closed"
  let socket: SocketLike | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const pingMs = options.pingMs ?? 10_000
  const pongMs = options.pongMs ?? 5_000
  let heardAt = 0
  let pongAt = 0
  let pingedAt: number | undefined
  let probe: ReturnType<typeof setInterval> | undefined

  const setStatus = (next: SocketStatus) => {
    if (status === next) return
    status = next
    options.onStatus?.(next)
  }

  function open() {
    if (closed) return
    timer = undefined
    setStatus("connecting")
    let s: SocketLike
    try {
      s = connect(options.url)
    } catch {
      return retry()
    }
    socket = s
    s.addEventListener("open", () => {
      if (socket !== s) return
      heardAt = Date.now()
      pongAt = heardAt
      pingedAt = undefined
      watch()
      setStatus("open")
      s.send(JSON.stringify(options.hello()))
      options.onOpen?.()
    })
    s.addEventListener("message", (event) => {
      if (socket !== s) return
      heardAt = Date.now()
      pongAt = heardAt
      pingedAt = undefined
      attempt = 0
      if (event.data instanceof ArrayBuffer) return options.onBinary?.(event.data)
      const frame = parseFrame<In>(event.data)
      if (frame) options.onFrame(frame)
    })
    s.addEventListener("error", () => {})
    s.addEventListener("close", (event) => {
      if (socket !== s) return
      socket = null
      retry(closeIsFinal(event))
    })
  }

  function watch() {
    if (probe !== undefined) return
    probe = setInterval(() => check(), Math.min(2_000, pongMs))
    ;(probe as { unref?: () => void }).unref?.()
  }

  function unwatch() {
    if (probe !== undefined) clearInterval(probe)
    probe = undefined
  }

  function check(now = false) {
    const s = socket
    if (!s || status !== "open") return
    const t = Date.now()
    if (pingedAt !== undefined) {
      if (t - pingedAt < pongMs) return
      socket = null
      pingedAt = undefined
      try {
        s.close(4000, "no pong")
      } catch {}
      unwatch()
      setStatus("closed")
      return retry()
    }
    if (!now && t - heardAt < pingMs) return
    try {
      s.send(PING)
      pingedAt = t
    } catch {}
  }

  function reopen() {
    if (closed) return
    const s = socket
    socket = null
    pingedAt = undefined
    attempt = 0
    unwatch()
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    setStatus("closed")
    try {
      s?.close(4000, "reconnect")
    } catch {}
    open()
  }

  function retry(final = false) {
    unwatch()
    if (closed) return
    setStatus(final ? "blocked" : "closed")
    if (timer !== undefined) return
    const { baseMs, maxMs } = options.backoff ?? {}
    const wait = final ? SLOW_RETRY_MS : backoffDelay(attempt++, baseMs, maxMs, random)
    timer = setTimeout(open, wait)
  }

  const onOnline = () => {
    if (socket) check(true)
    else reopen()
  }
  const onOffline = () => {
    if (!socket) return
    const s = socket
    socket = null
    pingedAt = undefined
    unwatch()
    setStatus("closed")
    try {
      s.close(4001, "offline")
    } catch {}
    retry()
  }
  const onVisible = () => {
    if (globalThis.document?.visibilityState !== "visible") return
    if (!socket) return reopen()
    if (Date.now() - pongAt > pingMs + pongMs) return reopen()
    check(true)
  }
  globalThis.addEventListener?.("online", onOnline)
  globalThis.addEventListener?.("offline", onOffline)
  globalThis.document?.addEventListener?.("visibilitychange", onVisible)

  const api: SyncSocket = {
    get status() {
      return status
    },
    send(frame) {
      if (status !== "open" || !socket) return false
      try {
        socket.send(JSON.stringify(frame))
        return true
      } catch {
        return false
      }
    },
    reconnect() {
      if (closed) return
      if (!socket) return reopen()
      if (Date.now() - heardAt > pingMs) return reopen()
      check(true)
    },
    close() {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      globalThis.removeEventListener?.("online", onOnline)
      globalThis.removeEventListener?.("offline", onOffline)
      globalThis.document?.removeEventListener?.("visibilitychange", onVisible)
      unwatch()
      const s = socket
      socket = null
      s?.close(1000, "closed")
      setStatus("closed")
    },
  }

  open()
  return api
}

type FrameOf<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

export type UserChannel = {
  send(frame: ClientToUser): boolean
  on<T extends UserToClient["t"]>(t: T, fn: (frame: FrameOf<T>) => void): () => void
  onOpen(fn: () => void): () => void
  onStatus(fn: (status: SocketStatus) => void): () => void
  onBinary(fn: (data: ArrayBuffer) => void): () => void
  room(options: RoomChannelOptions): RoomChannel
}

export type UserChannelHost = UserChannel & {
  attach(send: (frame: ClientToOwner) => boolean): () => void
  deliver(frame: OwnerToClient): void
  deliverBinary(data: ArrayBuffer): void
  opened(): void
  status(status: SocketStatus): void
}

function createUserChannel(): UserChannelHost {
  const listeners = new Map<string, Set<(frame: never) => void>>()
  const openers = new Set<() => void>()
  const statuses = new Set<(status: SocketStatus) => void>()
  const binaries = new Set<(data: ArrayBuffer) => void>()
  let sender: ((frame: ClientToOwner) => boolean) | null = null
  let status: SocketStatus = "closed"
  const rooms = new Map<RoomId, Set<RoomChannelOptions>>()
  const subscribe = (roomId: RoomId, room: RoomChannelOptions) => {
    sender?.({ t: "subscribe", roomId, lastSeq: room.lastSeq() })
    room.onStatus("open")
    room.onOpen()
  }
  return {
    send: (frame) => sender?.(frame) ?? false,
    on(t, fn) {
      let set = listeners.get(t)
      if (!set) listeners.set(t, (set = new Set()))
      set.add(fn as (frame: never) => void)
      return () => {
        set.delete(fn as (frame: never) => void)
        if (set.size === 0) listeners.delete(t)
      }
    },
    onOpen(fn) {
      openers.add(fn)
      return () => void openers.delete(fn)
    },
    onStatus(fn) {
      statuses.add(fn)
      return () => void statuses.delete(fn)
    },
    onBinary(fn) {
      binaries.add(fn)
      return () => void binaries.delete(fn)
    },
    deliverBinary(data) {
      for (const fn of Array.from(binaries)) fn(data)
    },
    attach(send) {
      sender = send
      return () => {
        if (sender === send) {
          sender = null
          status = "closed"
          for (const fn of Array.from(statuses)) fn(status)
          for (const set of rooms.values()) for (const room of set) room.onStatus(status)
        }
      }
    },
    room(options) {
      const { roomId } = options
      let set = rooms.get(roomId)
      if (!set) rooms.set(roomId, (set = new Set()))
      set.add(options)
      if (status === "open")
        queueMicrotask(() => {
          if (!set.has(options)) return
          if (status === "open") subscribe(roomId, options)
          else options.onStatus(status)
        })
      else options.onStatus(status)
      return {
        send: (frame) => set.has(options) && status === "open" && (sender?.({ t: "room", roomId, frame }) ?? false),
        close() {
          if (!set.delete(options)) return
          if (!set.size) {
            rooms.delete(roomId)
            sender?.({ t: "unsubscribe", roomId })
          }
          options.onStatus("closed")
        },
      }
    },
    status(next) {
      if (next === "open") return
      status = next
      for (const fn of Array.from(statuses)) fn(next)
      for (const set of rooms.values()) for (const room of set) room.onStatus(next)
    },
    deliver(frame) {
      if (frame.t === "room") {
        for (const room of rooms.get(frame.roomId) ?? []) room.onFrame(frame.frame)
        return
      }
      for (const fn of listeners.get(frame.t) ?? []) (fn as (f: UserToClient) => void)(frame)
    },
    opened() {
      status = "open"
      for (const fn of Array.from(statuses)) fn(status)
      for (const [roomId, set] of rooms) for (const room of set) subscribe(roomId, room)
      for (const fn of Array.from(openers)) fn()
    },
  }
}

export type RoomChannelOptions = {
  roomId: RoomId
  lastSeq(): number
  onFrame(frame: RoomToClient): void
  onOpen(): void
  onStatus(status: SocketStatus): void
}

export type RoomChannel = {
  send(frame: ClientToRoom): boolean
  close(): void
}

export const userChannel = createUserChannel()
