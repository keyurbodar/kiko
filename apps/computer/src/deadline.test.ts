import { assert, describe, it } from "@effect/vitest"
import { Deadline } from "./deadline"
import { Fail } from "./log"

const CANCELLED = new Fail({ code: "cancelled", message: "the agent cancelled this call" })

describe("deadline children", () => {
  it("shares what is left of the parent's budget", () => {
    const parent = new Deadline(60_000)

    const child = parent.child(1_000)

    assert.isAtLeast(child.budgetMs, 59_000)
    assert.isAtMost(child.budgetMs, 60_000)
  })

  it("aborts at once when the parent already ran out of time", () => {
    const parent = new Deadline(60_000)
    parent.controller.abort(CANCELLED)

    const child = parent.child(1_000)

    assert.isTrue(child.aborted)
    assert.strictEqual(child.signal.reason, CANCELLED)
  })

  it("aborts with the parent when the parent aborts later", () => {
    const parent = new Deadline(60_000)
    const child = parent.child(1_000)

    parent.controller.abort(CANCELLED)

    assert.isTrue(child.aborted)
    assert.strictEqual(child.signal.reason, CANCELLED)
  })
})
