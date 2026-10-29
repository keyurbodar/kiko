import type { TaskInspection } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { scheduledDeadline } from "./schedules"

const routine = (phase: string, status = "running"): Pick<TaskInspection, "record"> =>
  ({
    record: {
      id: 1,
      kind: "kiko.routine",
      abortRequested: false,
      background: true,
      state: { status, checkpoint: { phase } },
      input: { routineId: "r", runAt: 1_000, roomId: "room", target: "kiko" },
    },
  }) as unknown as Pick<TaskInspection, "record">

describe("scheduledDeadline", () => {
  it("keeps the wake for a routine that is still waiting", () => {
    expect(scheduledDeadline(routine("wait"))).toBe(1_000)
  })

  it("keeps the wake for a routine that is already delivering, so a restart still resumes it", () => {
    expect(scheduledDeadline(routine("deliver"))).toBe(1_000)
  })

  it("drops the wake once the task is terminal", () => {
    expect(scheduledDeadline(routine("deliver", "terminal"))).toBeUndefined()
  })
})
