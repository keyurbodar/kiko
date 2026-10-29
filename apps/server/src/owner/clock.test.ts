import type { TaskInspection } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { projectRecovery } from "./clock"

const NOW = 1_800_000_000_000

const task = (id: number, runAt: number): TaskInspection =>
  ({
    record: {
      id,
      kind: "kiko.routine",
      abortRequested: false,
      state: { status: "pending", checkpoint: { phase: "wait" } },
      input: { runAt },
    },
    state: { kind: "waiting" },
  }) as unknown as TaskInspection

const deadline = (task: TaskInspection) => (task.record.input as { runAt: number }).runAt

describe("projectRecovery", () => {
  it("keeps the exact time for a routine still in the future", () => {
    const { next } = projectRecovery([task(2, NOW + 60_000)], new Map(), undefined, NOW, deadline)
    expect(next).toBe(NOW + 60_000)
  })

  it("leaves a routine whose time has passed to the owner deadline instead of arming the agent again", () => {
    const { next, resume } = projectRecovery([task(1, NOW - 5_000)], new Map(), undefined, NOW, deadline)
    expect(next).toBeUndefined()
    expect(resume).toHaveLength(1)
  })
})
