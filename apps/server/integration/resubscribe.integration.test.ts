import { OWNER_RPC_PATH, OwnerRpcs } from "@kiko/protocol"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { connect, type Counters, signIn } from "./owner"
import { localWorker } from "./worker"

const sum = (counters: Counters, matches: (key: string) => boolean): number =>
  Object.entries(counters).reduce((total, [key, value]) => (matches(key) ? total + value : total), 0)

const billedWrites = (counters: Counters): number =>
  (counters["owner.rowsWritten"] ?? sum(counters, (key) => key.endsWith(".rowsWritten"))) +
  sum(counters, (key) => key.endsWith(".kvKeysPut")) +
  sum(counters, (key) => key.endsWith(".kvKeysDeleted")) +
  sum(counters, (key) => key.endsWith(".alarmWrites"))

const clientFor = (url: URL, token: string) => {
  const target = new URL(OWNER_RPC_PATH, url)
  target.protocol = "ws:"
  return Effect.gen(function* () {
    const context = yield* Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(target.href, { protocols: ["kiko", token] })),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      ),
    )
    return yield* RpcClient.make(OwnerRpcs).pipe(Effect.provide(context))
  })
}

describe("coming back to the tab", () => {
  it.live("resubscribes the chat list from its cursor without billing a row", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "resubscribe")
      yield* connect(worker.url, owner.token)
      const client = yield* clientFor(worker.url, owner.token)

      const first = yield* Stream.runCollect(
        client["user.subscribe"]({}).pipe(Stream.takeUntil((item) => item.kind === "synchronized")),
      )
      const snapshot = [...first].find((item) => item.kind === "snapshot")
      assert.strictEqual(snapshot?.kind, "snapshot")
      if (snapshot?.kind !== "snapshot") return assert.fail("a first subscribe sends a snapshot")
      const cursor = snapshot.snapshot.seq
      assert.isAbove(cursor, 0)

      yield* owner.post("api/dev/stats/reset", {})
      const replay = yield* Stream.runCollect(
        client["user.subscribe"]({ afterSequence: cursor }).pipe(
          Stream.takeUntil((item) => item.kind === "synchronized"),
        ),
      )
      const projected = [...replay].filter((item) => item.kind === "event" && item.event.t === "chat")
      assert.isAtLeast(projected.length, 1, "a replay ends with a projection of every chat")
      assert.isFalse(
        [...replay].some((item) => item.kind === "snapshot"),
        "a replay never re-downloads the chat list",
      )

      const meter = yield* owner.meter()
      assert.strictEqual(meter.billingVersion, 1, "KV-key and setAlarm meters are live")
      const billed = Object.entries(meter.counters).filter(([, value]) => value > 0)
      const wrote = (meter.statements ?? [])
        .filter((row) => row.rowsWritten > 0)
        .slice(0, 4)
        .map((row) => `${row.kind} wrote ${row.rowsWritten}: ${row.sql.replace(/\s+/g, " ").slice(0, 120)}`)
      assert.strictEqual(
        billedWrites(meter.counters),
        0,
        `a resubscribe bills no row: ${JSON.stringify(billed)} ${wrote.join(" | ")}`,
      )
    }).pipe(Effect.scoped),
  )
})
