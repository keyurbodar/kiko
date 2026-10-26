import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { nextOccurrence, RecurrenceError } from "./recurrence"

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
