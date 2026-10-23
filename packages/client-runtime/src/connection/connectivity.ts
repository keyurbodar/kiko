import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import type { NetworkStatus } from "./model"

export class Connectivity extends Context.Service<
  Connectivity,
  {
    readonly status: Effect.Effect<NetworkStatus>
    readonly changes: Stream.Stream<NetworkStatus>
  }
>()("@kiko/client-runtime/connection/Connectivity") {}

export const layer = (service: Connectivity["Service"]) => Layer.succeed(Connectivity, Connectivity.of(service))

const browserStatus = (): NetworkStatus =>
  typeof navigator === "undefined" || typeof navigator.onLine !== "boolean"
    ? "unknown"
    : navigator.onLine
      ? "online"
      : "offline"

export const layerBrowser = layer({
  status: Effect.sync(browserStatus),
  changes: Stream.callback<NetworkStatus>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (typeof window === "undefined") return () => {}
        const online = () => Queue.offerUnsafe(queue, "online")
        const offline = () => Queue.offerUnsafe(queue, "offline")
        window.addEventListener("online", online)
        window.addEventListener("offline", offline)
        return () => {
          window.removeEventListener("online", online)
          window.removeEventListener("offline", offline)
        }
      }),
      (stop) => Effect.sync(stop),
    ),
  ),
})

export const layerAlwaysOnline = layer({ status: Effect.succeed("online"), changes: Stream.never })
