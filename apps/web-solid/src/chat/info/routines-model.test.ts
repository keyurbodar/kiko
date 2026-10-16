import { describe, expect, test } from "bun:test"
import type { Trigger } from "@kiko/protocol"
import { triggerLabel } from "./routines-model"

const at = "2026-10-09T09:00:00Z"
const UTC = "UTC"

const cases: Array<[string, Trigger, string]> = [
  ["once", { on: "time", at }, "Once, Oct 9 at 9:00 AM"],
  ["daily", { on: "time", at, rrule: "FREQ=DAILY" }, "Every day at 9:00 AM"],
  ["every two days", { on: "time", at, rrule: "RRULE:FREQ=DAILY;INTERVAL=2" }, "Every 2 days at 9:00 AM"],
  ["weekdays", { on: "time", at, rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }, "Weekdays at 9:00 AM"],
  ["some days", { on: "time", at, rrule: "FREQ=WEEKLY;BYDAY=MO,WE" }, "Every Mon, Wed at 9:00 AM"],
  ["weekly", { on: "time", at, rrule: "FREQ=WEEKLY" }, "Every week at 9:00 AM"],
  ["hourly", { on: "time", at, rrule: "FREQ=HOURLY;INTERVAL=3" }, "Every 3 hours"],
  ["an unknown rule", { on: "time", at, rrule: "FREQ=SECONDLY" }, "Repeats"],
  ["a bad date", { on: "time", at: "soon" }, "On a schedule"],
  ["the human's message", { on: "message", contains: "deploy" }, "When you send a message with “deploy”"],
  ["a webhook", { on: "webhook" }, "When its webhook is called"],
  ["a trigger kiko dropped", { on: "watch", url: "https://x.test", everyMinutes: 15 } as unknown as Trigger, "Trigger no longer supported"],
]

describe("triggerLabel", () => {
  for (const [name, trigger, want] of cases) test(name, () => expect(triggerLabel(trigger, UTC)).toBe(want))
})
