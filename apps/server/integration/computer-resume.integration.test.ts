import { generateKeys } from "@kiko/computer/sign"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { connectDaemon, HELLO, pair } from "./daemon"
import { connect, idle, signIn } from "./owner"
import { localWorker } from "./worker"

const RESUME_SETTLE_MS = 500
const SHELL = { exitCode: 0, output: "survived", truncated: false, timedOut: false }

describe("a call that outlives its socket", () => {
  it.live("returns the output of a call the daemon finishes after a reconnect", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "pc-resume")
      const session = yield* connect(worker.url, owner.token)
      const minted = yield* session.client["pc.pairCode"]()
      const keys = yield* Effect.promise(() => generateKeys())
      const paired = yield* pair(worker.url, minted.code, keys.publicKey)

      const first = yield* Effect.acquireRelease(connectDaemon(worker.url, paired, keys), (open) =>
        Effect.sync(() => open.close()),
      )
      first.send(JSON.stringify(HELLO))
      yield* Effect.promise(() => first.take((frame) => frame.t === "welcome"))

      const room = yield* session.newRoom("resume")
      yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })
      const mark = yield* room.mark()
      yield* room.send('[tool computer_shell {"command":"echo survived"}]')

      const call = yield* Effect.promise(() => first.take((frame) => frame.t === "call"))
      const id = String(call.id)
      first.close()

      const second = yield* Effect.acquireRelease(connectDaemon(worker.url, paired, keys), (open) =>
        Effect.sync(() => open.close()),
      )
      second.send(JSON.stringify({ ...HELLO, resume: { running: [id], recent: [] } }))
      yield* Effect.promise(() => second.take((frame) => frame.t === "welcome"))
      yield* idle(RESUME_SETTLE_MS)

      const calls = [...first.seen(), ...second.seen()].filter((frame) => frame.t === "call")
      assert.strictEqual(calls.length, 1, "a running call is never sent again")

      second.send(JSON.stringify({ t: "result", id, ok: true, value: SHELL }))

      yield* room.untilIdleAfter(mark)

      const said = (yield* room.messages())
        .map((message) => message.text ?? "")
        .filter((text) => text.includes("survived"))
      assert.isNotEmpty(said, "the agent saw the output the daemon kept")
    }).pipe(Effect.scoped),
  )
})
