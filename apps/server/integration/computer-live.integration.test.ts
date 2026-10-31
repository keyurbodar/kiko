import { encodeFrame } from "@kiko/computer/frame"
import { generateKeys } from "@kiko/computer/sign"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { connectDaemon, HELLO, pair } from "./daemon"
import { connect, signIn } from "./owner"
import { localWorker } from "./worker"

const LIVE_MS = "20 seconds"

function openLive(url: URL, pcId: string, token: string): Promise<WebSocket> {
  const target = new URL(`api/pc/live/${pcId}`, url)
  target.protocol = "ws:"
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.href, ["kiko", token])
    socket.binaryType = "arraybuffer"
    socket.addEventListener("open", () => resolve(socket), { once: true })
    socket.addEventListener("error", () => reject(new Error("the live socket failed")), { once: true })
  })
}

function nextBinary(socket: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const on = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return
      socket.removeEventListener("message", on)
      resolve(new Uint8Array(event.data))
    }
    socket.addEventListener("message", on)
  })
}

const within = <A>(work: Promise<A>, what: string) =>
  Effect.promise(() => work).pipe(
    Effect.timeoutOrElse({
      duration: LIVE_MS,
      orElse: () => Effect.fail(new Error(what)),
    }),
  )

describe.concurrent("computer live socket", () => {
  it.live("carries a relay frame to the viewer as bytes, then acks it back", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "pc-live")
      const session = yield* connect(worker.url, owner.token)
      const minted = yield* session.client["pc.pairCode"]()
      const keys = yield* Effect.promise(() => generateKeys())
      const paired = yield* pair(worker.url, minted.code, keys.publicKey)
      const daemon = yield* Effect.acquireRelease(connectDaemon(worker.url, paired, keys), (open) =>
        Effect.sync(() => open.close()),
      )

      daemon.send(JSON.stringify(HELLO))
      yield* within(
        daemon.take((frame) => frame.t === "welcome"),
        "the daemon never got its welcome",
      )

      const live = yield* Effect.acquireRelease(
        Effect.promise(() => openLive(worker.url, paired.id, owner.token)),
        (socket) => Effect.sync(() => socket.close()),
      )

      live.send(JSON.stringify({ t: "live", fps: 15, maxWidth: 1600, quality: 65 }))
      yield* within(
        daemon.take((frame) => frame.t === "live" && frame.on === true),
        "the daemon was never asked to share",
      )

      const image = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])
      const bytes = encodeFrame({ kind: "jpeg", width: 64, height: 48, seq: 1, cursor: null }, image)
      const received = nextBinary(live)
      daemon.sendBinary(bytes)

      assert.deepStrictEqual(yield* within(received, "the viewer never got the frame"), bytes)

      live.send(JSON.stringify({ t: "ack", seq: 1 }))
      const ack = yield* within(
        daemon.take((frame) => frame.t === "ack"),
        "the daemon never got the viewer's ack",
      )
      assert.strictEqual(ack.seq, 1)
    }).pipe(Effect.scoped),
  )

  it.live("stops the relay when the last viewer goes away", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "pc-live-close")
      const session = yield* connect(worker.url, owner.token)
      const minted = yield* session.client["pc.pairCode"]()
      const keys = yield* Effect.promise(() => generateKeys())
      const paired = yield* pair(worker.url, minted.code, keys.publicKey)
      const daemon = yield* Effect.acquireRelease(connectDaemon(worker.url, paired, keys), (open) =>
        Effect.sync(() => open.close()),
      )

      daemon.send(JSON.stringify(HELLO))
      yield* within(
        daemon.take((frame) => frame.t === "welcome"),
        "the daemon never got its welcome",
      )

      const live = yield* Effect.promise(() => openLive(worker.url, paired.id, owner.token))
      live.send(JSON.stringify({ t: "live", fps: 15, maxWidth: 1600, quality: 65 }))
      yield* within(
        daemon.take((frame) => frame.t === "live" && frame.on === true),
        "the daemon was never asked to share",
      )

      live.close()
      const off = yield* within(
        daemon.take((frame) => frame.t === "live" && frame.on === false),
        "the daemon was never told to stop",
      )
      assert.strictEqual(off.on, false)
    }).pipe(Effect.scoped),
  )
})
