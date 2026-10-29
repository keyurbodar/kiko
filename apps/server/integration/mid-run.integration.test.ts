import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { connect, signIn } from "./owner"
import { localWorker } from "./worker"

const runningStep = (signal: { t: string; step?: { status: string } }) =>
  signal.t === "step" && signal.step?.status === "running"

describe("a message sent while an agent works", () => {
  it.live("reaches the running turn as an ordinary message without cancelling the tool in flight", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "mid-run-steer")
      const session = yield* connect(worker.url, owner.token)
      const room = yield* session.newRoom("mid run steer")
      yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })

      const mark = yield* room.mark()
      yield* room.send("[calls 3] first")
      yield* room.untilSignal(runningStep)
      yield* room.send("second")
      yield* room.untilIdleAfter(mark)

      const reply = (yield* room.messages()).findLast((message) => message.text?.startsWith("heard:"))
      assert.include(reply?.text, "heard: [calls 3] first | second")
      assert.strictEqual(reply?.steps, 3)
    }).pipe(Effect.scoped),
  )
})

describe("stop while an agent works", () => {
  it.live("ends the turn instead of letting it run on", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "mid-run-stop")
      const session = yield* connect(worker.url, owner.token)
      const room = yield* session.newRoom("mid run stop")
      yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })

      const mark = yield* room.mark()
      yield* room.send("[calls 4] keep going")
      yield* room.untilSignal(runningStep)
      yield* room.stop()
      yield* room.untilIdleAfter(mark)

      const after = yield* room.messages()
      assert.isFalse(
        after.some((message) => message.text?.startsWith("heard:")),
        "a stopped turn must not finish its work",
      )
    }).pipe(Effect.scoped),
  )
})
