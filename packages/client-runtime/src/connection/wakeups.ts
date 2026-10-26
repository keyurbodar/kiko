import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

export type ConnectionWakeup = "application-active" | "network-changed"

export const shouldResubscribeAfterWakeup = (reason: ConnectionWakeup): boolean => reason === "application-active"

export class ConnectionWakeups extends Context.Service<
  ConnectionWakeups,
  { readonly changes: Stream.Stream<ConnectionWakeup> }
>()("@kiko/client-runtime/connection/ConnectionWakeups") {}

export const layer = (service: ConnectionWakeups["Service"]) =>
  Layer.succeed(ConnectionWakeups, ConnectionWakeups.of(service))

export const layerBrowser = layer({
  changes: Stream.callback<ConnectionWakeup>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (typeof document === "undefined") return () => {}
        const visible = () => {
          if (document.visibilityState === "visible") Queue.offerUnsafe(queue, "application-active")
        }
        document.addEventListener("visibilitychange", visible)
        return () => document.removeEventListener("visibilitychange", visible)
      }),
      (stop) => Effect.sync(stop),
    ),
  ),
})

export const layerNone = layer({ changes: Stream.never })
