import { describe, expect, it } from "@effect/vitest"
import { Deadline } from "./deadline"
import { Fail } from "./log"

function cancelled(): Fail {
  return new Fail({ code: "cancelled", message: "the call was cancelled" })
}

describe("Deadline.child", () => {
  it("is already aborted when the parent is aborted", () => {
    const parent = new Deadline(1_000)
    parent.controller.abort(cancelled())

    const child = parent.child(10_000)

    expect(child.aborted).toBe(true)
    expect(child.cancelled).toBe(true)
  })

  it("aborts with the parent when the parent aborts later", () => {
    const parent = new Deadline(1_000)
    const child = parent.child(10_000)
    expect(child.aborted).toBe(false)

    parent.controller.abort(cancelled())

    expect(child.aborted).toBe(true)
    expect(child.cancelled).toBe(true)
  })
})
