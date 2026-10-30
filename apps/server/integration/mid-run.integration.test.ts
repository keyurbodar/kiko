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

describe("twelve short messages sent back to back", () => {
  it.live("reach the agent as one turn, in the order they were sent", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "rapid-fire")
      const session = yield* connect(worker.url, owner.token)
      const room = yield* session.newRoom("rapid fire")
      yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })

      const texts = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
      const mark = yield* room.mark()
      yield* Effect.forEach(texts, (text) => room.send(text), { concurrency: "unbounded" })
      yield* room.untilIdleAfter(mark)

      const all = (yield* room.messages()).filter((message) => message.text?.startsWith("heard:"))
      assert.strictEqual(all.length, 1, "twelve messages sent together are answered once")
      const said = all[0]?.text ?? ""
      let at = -1
      for (const text of texts) {
        const next = said.indexOf(text, at + 1)
        assert.isAbove(next, at, `${text} is read in the order it was sent`)
        at = next
      }
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
