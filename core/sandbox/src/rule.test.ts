import { assert, describe, it } from "@effect/vitest"
import { ruleProblem } from "./rule"

describe("ruleProblem ranges", () => {
  it("accepts zero for hour, minute and second", () => {
    assert.strictEqual(ruleProblem("FREQ=DAILY;BYHOUR=0;BYMINUTE=0;BYSECOND=0"), null)
    assert.strictEqual(ruleProblem("FREQ=DAILY;BYHOUR=0,12"), null)
  })

  it("rejects an hour past 23", () => {
    assert.strictEqual(ruleProblem("FREQ=DAILY;BYHOUR=24"), "rrule BYHOUR must be 0 to 23")
  })

  it("rejects a minute past 59", () => {
    assert.strictEqual(ruleProblem("FREQ=DAILY;BYMINUTE=60"), "rrule BYMINUTE must be 0 to 59")
  })

  it("rejects a second past 59", () => {
    assert.strictEqual(ruleProblem("FREQ=DAILY;BYSECOND=60"), "rrule BYSECOND must be 0 to 59")
  })
})
