import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Socket from "effect/socket/Socket"
import * as Connectivity from "../connection/connectivity"
import * as Endpoint from "../connection/endpoint"
import { connectionProjectionPhase } from "../connection/model"
import * as Supervisor from "../connection/supervisor"
import * as Wakeups from "../connection/wakeups"
import * as Cache from "../platform/cache"
import * as IndexedDb from "../platform/indexedDb"
import * as RpcSession from "../rpc/session"
import * as Pending from "./pending"
import * as UserState from "./userState"

export type OwnerRuntimeServices =
  | Supervisor.OwnerSupervisor
  | UserState.UserStore
  | Pending.PendingCommands
  | Cache.SnapshotCache
  | Wakeups.ConnectionWakeups

export interface OwnerRuntimeOptions {
  readonly endpoint: Endpoint.OwnerEndpointOptions
  readonly connect: boolean
  readonly store: Layer.Layer<Cache.SnapshotStore>
  readonly connectivity: Layer.Layer<Connectivity.Connectivity>
  readonly wakeups: Layer.Layer<Wakeups.ConnectionWakeups>
  readonly webSocket?: Layer.Layer<Socket.WebSocketConstructor>
}

const userDisconnects = Layer.effectDiscard(
  Effect.gen(function* () {
    const supervisor = yield* Supervisor.OwnerSupervisor
    const user = yield* UserState.UserStore
    yield* SubscriptionRef.changes(supervisor.state).pipe(
      Stream.filter((state) => connectionProjectionPhase(state) === "disconnected"),
      Stream.runForEach(() => user.disconnected),
      Effect.forkScoped,
    )
  }),
)

export const layer = (options: OwnerRuntimeOptions): Layer.Layer<OwnerRuntimeServices> => {
  const cache = Cache.layer.pipe(Layer.provide(options.store))
  const base = Layer.mergeAll(
    cache,
    Pending.layer,
    Endpoint.layer(options.endpoint),
    options.connectivity,
    options.wakeups,
  )
  const user = UserState.layer.pipe(Layer.provideMerge(base))
  const sessions = RpcSession.layer.pipe(
    Layer.provide(Layer.mergeAll(user, options.webSocket ?? Socket.layerWebSocketConstructorGlobal)),
  )
  const supervisor = Supervisor.layer({ initiallyDesired: options.connect }).pipe(
    Layer.provideMerge(Layer.mergeAll(user, sessions)),
  )
  return userDisconnects.pipe(Layer.provideMerge(supervisor))
}

export const layerBrowser = (options: {
  readonly endpoint: Endpoint.OwnerEndpointOptions
  readonly connect: boolean
  readonly cache: { readonly database: string; readonly namespace: string } | null
}) =>
  layer({
    endpoint: options.endpoint,
    connect: options.connect,
    store: options.cache ? IndexedDb.layer(options.cache) : Cache.layerMemoryStore,
    connectivity: Connectivity.layerBrowser,
    wakeups: Wakeups.layerBrowser,
  })
