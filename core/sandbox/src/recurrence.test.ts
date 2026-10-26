import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { localMoment, nextOccurrence, RecurrenceError } from "./recurrence"

const AFTER = Date.UTC(2026, 0, 1)

const next = (rrule: string, tz = "UTC") =>
  Effect.try({
    try: () => nextOccurrence(rrule, tz, AFTER),
    catch: (error) => error as RecurrenceError,
  })

describe("nextOccurrence", () => {
  it.effect("reads a sound rule", () =>
    Effect.gen(function* () {
      const date = yield* next("FREQ=DAILY;BYHOUR=7;BYMINUTE=0")
      assert.strictEqual(date?.toISOString(), "2026-01-01T07:00:00.000Z")
    }),
  )

  it.effect("fails with a tagged error when the rule is unsafe", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(next("FREQ=DAILY;DTSTART:20260101T000000Z"))
      const failure =
        Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail" ? exit.cause.reasons[0].error : null
      assert.strictEqual(failure?._tag, "RecurrenceError")
      assert.strictEqual(failure?.reason, "unsafe_rule")
      assert.strictEqual(failure?.timeZone, "UTC")
      assert.isString(failure?.message)
    }),
  )
})

describe("localMoment", () => {
  it("reads a local time in the zone", () => {
    assert.strictEqual(
      new Date(localMoment("2026-05-04T08:30", "Europe/Berlin") ?? 0).toISOString(),
      "2026-05-04T06:30:00.000Z",
    )
  })

  it("keeps seconds", () => {
    assert.strictEqual(
      new Date(localMoment("2026-01-15T09:00:15", "America/New_York") ?? 0).toISOString(),
      "2026-01-15T14:00:15.000Z",
    )
  })

  it("moves a time skipped when clocks go forward to just after the gap", () => {
    assert.strictEqual(
      new Date(localMoment("2026-03-08T02:30", "America/New_York") ?? 0).toISOString(),
      "2026-03-08T07:30:00.000Z",
    )
  })

  it("picks the first of a time that happens twice when clocks go back", () => {
    assert.strictEqual(
      new Date(localMoment("2026-11-01T01:30", "America/New_York") ?? 0).toISOString(),
      "2026-11-01T05:30:00.000Z",
    )
  })

  it("leaves a time with an offset alone", () => {
    assert.strictEqual(localMoment("2026-05-04T08:30:00+02:00", "America/New_York"), null)
    assert.strictEqual(localMoment("2026-05-04T08:30Z", "America/New_York"), null)
  })

  it("refuses a date that does not exist", () => {
    assert.strictEqual(localMoment("2026-02-30T08:30", "UTC"), null)
  })
})
