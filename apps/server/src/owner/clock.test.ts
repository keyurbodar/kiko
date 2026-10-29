import type { TaskInspection } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { projectRecovery, RECOVERY_DELAY_MS } from "./clock"

const NOW = 1_800_000_000_000

const task = (id: number, runAt: number, kind = "waiting"): TaskInspection =>
  ({
    record: {
      id,
      kind: "kiko.routine",
      abortRequested: false,
      state: { status: "pending", checkpoint: { phase: "wait" } },
      input: { runAt },
    },
    state: { kind },
  }) as unknown as TaskInspection

const deadline = (task: TaskInspection) => (task.record.input as { runAt: number }).runAt

describe("projectRecovery", () => {
  it("keeps a deadline for a routine whose time has already passed", () => {
    const due = task(1, NOW - 5_000)
    const { next } = projectRecovery([due], new Map(), undefined, NOW, deadline)
    expect(next).toBe(NOW + RECOVERY_DELAY_MS)
  })

  it("keeps the exact time for a routine still in the future", () => {
    const future = task(2, NOW + 60_000)
    const { next } = projectRecovery([future], new Map(), undefined, NOW, deadline)
    expect(next).toBe(NOW + 60_000)
  })
})
