export type CdpSocket = {
  send(data: string): void
  close(): void
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void
}

export type CdpHandler = (params: Record<string, unknown>, sessionId: string | undefined) => void

export type Cdp = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
  on(method: string, handler: CdpHandler): () => void
  onClose(handler: () => void): void
  close(): void
}

export type CdpDeps = {
  open?: (url: string) => CdpSocket
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

type Reply = {
  id?: unknown
  method?: unknown
  params?: unknown
  sessionId?: unknown
  result?: unknown
  error?: unknown
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function openCdp(url: string, deps: CdpDeps = {}): Promise<Cdp> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    let socket: CdpSocket
    try {
      socket = (deps.open ?? ((target: string) => new WebSocket(target) as unknown as CdpSocket))(url)
    } catch (error) {
      reject(new Error(`cannot reach the browser's devtools socket: ${messageOf(error)}`))
      return
    }
    const pending = new Map<number, Pending>()
    const handlers = new Map<string, Set<CdpHandler>>()
    const closes = new Set<() => void>()
    let nextId = 1
    let gone = false

    const failAll = (message: string) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error(message))
      }
      pending.clear()
    }
    const lost = () => {
      if (gone) return
      gone = true
      failAll("the browser's devtools socket closed")
      for (const handler of closes) handler()
      closes.clear()
    }
    const deliver = (event: { data?: unknown }) => {
      if (typeof event.data !== "string") return
      let reply: Reply
      try {
        reply = JSON.parse(event.data) as Reply
      } catch {
        return
      }
      const sessionId = typeof reply.sessionId === "string" ? reply.sessionId : undefined
      if (typeof reply.id === "number") {
        const entry = pending.get(reply.id)
        if (!entry) return
        pending.delete(reply.id)
        clearTimeout(entry.timer)
        if (reply.error !== undefined) {
          const detail = reply.error as { message?: unknown }
          entry.reject(new Error(typeof detail.message === "string" ? detail.message : "the browser refused it"))
        } else entry.resolve(reply.result)
        return
      }
      if (typeof reply.method !== "string") return
      const params =
        typeof reply.params === "object" && reply.params !== null ? (reply.params as Record<string, unknown>) : {}
      for (const handler of handlers.get(reply.method) ?? []) handler(params, sessionId)
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("the browser's devtools socket did not open in time"))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.close()
    }

    socket.addEventListener("open", () => {
      clearTimeout(timer)
      resolve({
        send(method, params = {}, sessionId) {
          if (gone) return Promise.reject(new Error("the browser's devtools socket closed"))
          const id = nextId++
          return new Promise((done, fail) => {
            const entry: Pending = {
              resolve: done,
              reject: fail,
              timer: setTimeout(() => {
                pending.delete(id)
                fail(new Error(`the browser did not answer ${method} in time`))
              }, timeoutMs),
            }
            pending.set(id, entry)
            try {
              socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
            } catch (error) {
              pending.delete(id)
              clearTimeout(entry.timer)
              fail(new Error(messageOf(error)))
            }
          })
        },
        on(method, handler) {
          const set = handlers.get(method) ?? new Set<CdpHandler>()
          set.add(handler)
          handlers.set(method, set)
          return () => {
            set.delete(handler)
            if (set.size === 0) handlers.delete(method)
          }
        },
        onClose(handler) {
          if (gone) handler()
          else closes.add(handler)
        },
        close() {
          lost()
          socket.close()
        },
      })
    })
    socket.addEventListener("message", deliver)
    socket.addEventListener("close", lost)
    socket.addEventListener("error", lost)
  })
}
