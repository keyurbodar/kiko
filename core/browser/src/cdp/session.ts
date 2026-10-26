import * as Schema from "effect/Schema"
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping"
import { Effect, Exit, Scope } from "effect"
import { BROWSER } from "../config"

export type Commands = ProtocolMapping.Commands
export type Events = ProtocolMapping.Events
export type Method = keyof Commands
export type EventName = keyof Events
export type Params<M extends Method> = Commands[M]["paramsType"] extends [] ? undefined : Commands[M]["paramsType"][0]
export type Result<M extends Method> = Commands[M]["returnType"]
export type Payload<E extends EventName> = Events[E] extends [infer P] ? P : undefined

export class CdpError extends Schema.TaggedError<CdpError>()("CdpError", {
  kind: Schema.Literals(["closed", "timeout", "protocol"]),
  message: Schema.String,
}) {}

export interface Channel {
  readonly sessionId: string | undefined
  send<M extends Method>(method: M, params?: Params<M>): Promise<Result<M>>
  on<E extends EventName>(event: E, listener: (params: Payload<E>) => void): () => void
  waitFor<E extends EventName>(event: E, ms: number): Promise<Payload<E> | undefined>
}

export interface CdpSession extends Channel {
  channel(sessionId: string): Channel
  readonly closed: Promise<void>
  close(): Promise<void>
}

type Pending = (outcome: Effect.Effect<unknown, CdpError>) => void
type Listener = (params: unknown, sessionId: string | undefined) => void

export type SessionOptions = { commandMs?: number }

export async function openSession(url: string, options: SessionOptions = {}): Promise<CdpSession> {
  const commandMs = options.commandMs ?? BROWSER.commandMs
  const scope = Effect.runSync(Scope.make())
  const pending = new Map<number, Pending>()
  const listeners = new Map<string, Set<Listener>>()
  const onClose = new Set<() => void>()
  let nextId = 0
  let open = true
  let markClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve
  })

  const shutdown = (reason: string) => {
    if (!open) return
    open = false
    const error = Effect.fail(new CdpError({ kind: "closed", message: reason }))
    for (const resume of pending.values()) resume(error)
    pending.clear()
    for (const hook of onClose) hook()
    onClose.clear()
    markClosed()
  }

  const dispatch = (raw: string) => {
    const message = JSON.parse(raw) as {
      id?: number
      result?: unknown
      error?: { message: string; code: number }
      method?: string
      params?: unknown
      sessionId?: string
    }
    if (message.id !== undefined) {
      const resume = pending.get(message.id)
      if (!resume) return
      pending.delete(message.id)
      resume(
        message.error
          ? Effect.fail(new CdpError({ kind: "protocol", message: message.error.message }))
          : Effect.succeed(message.result),
      )
      return
    }
    if (!message.method) return
    const set = listeners.get(message.method)
    if (!set) return
    for (const listener of Array.from(set)) listener(message.params, message.sessionId)
  }

  const acquire = Effect.callback<WebSocket, CdpError>((resume) => {
    const ws = new WebSocket(url)
    ws.addEventListener("open", () => resume(Effect.succeed(ws)), { once: true })
    ws.addEventListener(
      "error",
      () => resume(Effect.fail(new CdpError({ kind: "closed", message: "The CDP socket failed to open" }))),
      {
        once: true,
      },
    )
    return Effect.sync(() => ws.close())
  }).pipe(
    Effect.timeoutOrElse({
      duration: commandMs,
      orElse: () => Effect.fail(new CdpError({ kind: "timeout", message: "The CDP socket did not open in time" })),
    }),
  )

  const socket = Effect.acquireRelease(acquire, (ws) =>
    Effect.sync(() => {
      shutdown("The CDP session was closed")
      try {
        ws.close()
      } catch {}
    }),
  )

  const ws = await Effect.runPromise(Scope.provide(scope)(socket))
  ws.addEventListener("message", (event) =>
    dispatch(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)),
  )
  ws.addEventListener("close", () => shutdown("The CDP socket closed"))
  ws.addEventListener("error", () => shutdown("The CDP socket failed"))

  const command = (method: string, params: unknown, sessionId: string | undefined) =>
    Effect.callback<unknown, CdpError>((resume) => {
      if (!open) return resume(Effect.fail(new CdpError({ kind: "closed", message: "The CDP socket is closed" })))
      const id = ++nextId
      pending.set(id, resume)
      ws.send(
        JSON.stringify(
          sessionId ? { id, method, params: params ?? {}, sessionId } : { id, method, params: params ?? {} },
        ),
      )
      return Effect.sync(() => pending.delete(id))
    }).pipe(
      Effect.timeoutOrElse({
        duration: commandMs,
        orElse: () =>
          Effect.fail(new CdpError({ kind: "timeout", message: `${method} got no answer in ${commandMs} ms` })),
      }),
    )

  const on = (event: string, sessionId: string | undefined, listener: (params: unknown) => void) => {
    const wrapped: Listener = (params, from) => {
      if (from === sessionId) listener(params)
    }
    const set = listeners.get(event) ?? new Set()
    listeners.set(event, set)
    set.add(wrapped)
    return () => {
      set.delete(wrapped)
    }
  }

  const waitFor = (event: string, sessionId: string | undefined, ms: number) => {
    let hit: { params: unknown } | undefined
    let wake: (() => void) | undefined
    const off = on(event, sessionId, (params) => {
      if (hit) return
      hit = { params }
      off()
      wake?.()
    })
    const wait = Effect.callback<unknown, CdpError>((resume) => {
      if (hit) return resume(Effect.succeed(hit.params))
      if (!open) return resume(Effect.fail(new CdpError({ kind: "closed", message: "The CDP socket is closed" })))
      const fail = () => resume(Effect.fail(new CdpError({ kind: "closed", message: "The CDP socket closed" })))
      wake = () => {
        onClose.delete(fail)
        resume(Effect.succeed(hit?.params))
      }
      onClose.add(fail)
      return Effect.sync(() => {
        onClose.delete(fail)
        off()
      })
    }).pipe(Effect.timeoutOrElse({ duration: ms, orElse: () => Effect.succeed(undefined) }))
    const promise = Effect.runPromise(wait)
    promise.catch(() => {})
    return promise
  }

  const channel = (sessionId: string | undefined): Channel => ({
    sessionId,
    send: (method, params) => Effect.runPromise(command(method, params, sessionId)) as never,
    on: (event, listener) => on(event, sessionId, listener as (params: unknown) => void),
    waitFor: (event, ms) => waitFor(event, sessionId, ms) as never,
  })

  return {
    ...channel(undefined),
    channel,
    closed,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
