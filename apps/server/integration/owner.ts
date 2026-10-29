import {
  CommandId,
  type Message,
  newRoomId,
  OWNER_RPC_PATH,
  OwnerRpcs,
  type RoomId,
  type RoomSignal,
  type RoomStreamItem,
} from "@kiko/protocol"
import { Effect, Fiber, Layer, Schema, Stream, SubscriptionRef } from "effect"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"

export type Counters = Record<string, number>
export type Meter = { counters: Counters; billingVersion?: number }

type Followed<A> = {
  readonly items: SubscriptionRef.SubscriptionRef<readonly A[]>
  readonly until: (ready: (all: readonly A[]) => boolean) => Effect.Effect<void>
}

const newCommandId = () => Schema.decodeSync(CommandId)(crypto.randomUUID())

const protocol = (url: URL, token: string) => {
  const target = new URL(OWNER_RPC_PATH, url)
  target.protocol = "ws:"
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(target.href, { protocols: ["kiko", token] })),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  )
}

const makeClient = (url: URL, token: string) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(protocol(url, token))
    return yield* RpcClient.make(OwnerRpcs).pipe(Effect.provide(context))
  })

type OwnerClient = Effect.Success<ReturnType<typeof makeClient>>

const follow = <A, E>(stream: Stream.Stream<A, E>) =>
  Effect.gen(function* () {
    const items = yield* SubscriptionRef.make<readonly A[]>([])
    const fiber = yield* stream.pipe(
      Stream.runForEach((item) => SubscriptionRef.update(items, (all) => [...all, item])),
      Effect.orDie,
      Effect.forkScoped,
    )
    const until = (ready: (all: readonly A[]) => boolean) =>
      Effect.raceFirst(
        SubscriptionRef.changes(items).pipe(Stream.filter(ready), Stream.runHead, Effect.asVoid),
        Fiber.join(fiber).pipe(Effect.andThen(Effect.die(new Error("the stream ended before the milestone")))),
      )
    return { items, until } satisfies Followed<A>
  })

const isSynchronized = (item: { kind: string }) => item.kind === "synchronized"

function messagesOf(items: readonly RoomStreamItem[]): Message[] {
  const byId = new Map<string, Message>()
  for (const item of items) {
    if (item.kind === "snapshot") for (const message of item.snapshot.messages) byId.set(message.id, message)
    if (item.kind === "event" && item.event.t === "message") byId.set(item.event.id, item.event)
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export class Room {
  constructor(
    readonly roomId: RoomId,
    private readonly client: OwnerClient,
    private readonly stream: Followed<RoomStreamItem>,
  ) {}

  messages(): Effect.Effect<Message[]> {
    return SubscriptionRef.get(this.stream.items).pipe(Effect.map(messagesOf))
  }

  errorRows(): Effect.Effect<number> {
    return this.messages().pipe(
      Effect.map((messages) => messages.filter((message) => message.event?.kind === "run_error").length),
    )
  }

  signals(): Effect.Effect<RoomSignal[]> {
    return SubscriptionRef.get(this.stream.items).pipe(
      Effect.map((items) => items.flatMap((item) => (item.kind === "signal" ? [item.signal] : []))),
    )
  }

  untilSignal(ready: (signal: RoomSignal) => boolean): Effect.Effect<void> {
    return this.stream.until((items) => items.some((item) => item.kind === "signal" && ready(item.signal)))
  }

  mark(): Effect.Effect<number> {
    return SubscriptionRef.get(this.stream.items).pipe(Effect.map((items) => items.length))
  }

  send(text: string) {
    return this.client["room.send"]({ roomId: this.roomId, commandId: newCommandId(), text })
  }

  stop() {
    return this.client["room.stop"]({ roomId: this.roomId, commandId: newCommandId() })
  }

  untilMessage(ready: (messages: Message[]) => boolean): Effect.Effect<void> {
    return this.stream.until((items) => ready(messagesOf(items)))
  }

  untilIdleAfter(mark: number): Effect.Effect<void> {
    return this.stream.until((items) =>
      items
        .slice(mark)
        .some((item) => item.kind === "signal" && item.signal.t === "status" && item.signal.state === "idle"),
    )
  }
}

export const connect = (url: URL, token: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient(url, token)
    const user = yield* follow(client["user.subscribe"]({}))
    yield* user.until((items) => items.some(isSynchronized))
    const openRoom = (roomId: RoomId, afterSequence?: number) =>
      Effect.gen(function* () {
        const stream = yield* follow(client["room.subscribe"]({ roomId, ...(afterSequence ? { afterSequence } : {}) }))
        yield* stream.until((items) => items.some(isSynchronized))
        return new Room(roomId, client, stream)
      })
    const newRoom = (title: string) =>
      Effect.gen(function* () {
        const roomId = newRoomId()
        yield* client["chat.command"]({ commandId: newCommandId(), op: { op: "create", roomId, title } })
        return yield* openRoom(roomId)
      })
    return { client, user: user.items, openRoom, newRoom }
  })

export type Owner = {
  readonly token: string
  post(path: string, body: unknown): Effect.Effect<unknown, Error>
  meter(): Effect.Effect<Meter, Error>
}

const request = (url: URL, init: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const answer = await fetch(url, init)
      if (!answer.ok) throw new Error(`${url.pathname} answered ${answer.status}`)
      return (await answer.json()) as unknown
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export const signIn = (url: URL, name: string): Effect.Effect<Owner, Error> =>
  Effect.gen(function* () {
    const { token } = (yield* request(new URL("api/auth/dev/session", url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: url.origin },
      body: JSON.stringify({ name }),
    })) as { token: string }
    const authorization = `Bearer ${token}`
    return {
      token,
      post: (path, body) =>
        request(new URL(path, url), {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body: JSON.stringify(body),
        }),
      meter: () =>
        request(new URL("api/dev/stats", url), { headers: { authorization } }) as Effect.Effect<Meter, Error>,
    }
  })

export const idle = (ms: number): Effect.Effect<void> => Effect.sleep(ms)
