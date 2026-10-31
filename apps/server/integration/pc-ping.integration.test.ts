import { generateKeys } from "@kiko/computer/sign"
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { RPC_PONG } from "../src/rpc/wire"
import { connectDaemon, HELLO, pair } from "./daemon"
import { connect, signIn } from "./owner"
import { localWorker } from "./worker"

const PING = JSON.stringify({ _tag: "Ping" })
const PONG_MS = "5 seconds"

describe.concurrent("pc socket", () => {
  it.live("answers the daemon's ping with a pong", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "pc-ping")
      const session = yield* connect(worker.url, owner.token)
      const minted = yield* session.client["pc.pairCode"]()
      const keys = yield* Effect.promise(() => generateKeys())
      const paired = yield* pair(worker.url, minted.code, keys.publicKey)
      const socket = yield* Effect.acquireRelease(connectDaemon(worker.url, paired, keys), (open) =>
        Effect.sync(() => open.close()),
      )

      socket.send(JSON.stringify(HELLO))
      for (let round = 0; round < 3; round++) {
        socket.send(PING)
        yield* Effect.promise(() => socket.next(RPC_PONG)).pipe(
          Effect.timeoutOrElse({
            duration: PONG_MS,
            orElse: () => Effect.fail(new Error("the daemon's ping got no pong")),
          }),
        )
      }
    }).pipe(Effect.scoped),
  )
})
