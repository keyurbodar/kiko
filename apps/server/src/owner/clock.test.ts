import type { TaskInspection } from "@earendil-works/pi-durable"
import type { ClockPort } from "@kiko/durable/clock-port"
import { afterEach, describe, expect, it, vi } from "vitest"
import { projectRecovery, RECOVERY_DELAY_MS, runDue } from "./clock"

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

function clock(deadlines = new Map<string, number>()) {
  const armed: number[] = []
  const port: ClockPort = {
    setWakeup: async (key, at) => {
      deadlines.set(key, at)
      armed.push(at)
    },
    clearWakeup: async (key) => {
      deadlines.delete(key)
    },
    dueWakeups: async () => [],
    deadline: (key) => deadlines.get(key),
  }
  return { port, deadlines, armed }
}

const fails = () => {
  throw new Error("boom")
}

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {})

describe("runDue", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("moves a failed handler forward instead of letting it refire at once", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    quiet()
    const { port, deadlines } = clock(new Map([["deletion_agents", NOW - 1]]))
    await expect(runDue(port, ["deletion_agents"], { deletion_agents: fails })).rejects.toThrow(AggregateError)
    expect(deadlines.get("deletion_agents")).toBe(NOW + RECOVERY_DELAY_MS)
  })

  it("doubles the wait on each failure up to half an hour", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    quiet()
    const { port, deadlines, armed } = clock(new Map([["reap", NOW - 1]]))
    for (let attempt = 0; attempt < 10; attempt += 1)
      await expect(runDue(port, ["reap"], { reap: fails })).rejects.toThrow(AggregateError)
    expect(armed).toEqual(
      [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000, 1_800_000].map(
        (ms) => NOW + ms,
      ),
    )
    expect(deadlines.get("reap")).toBe(NOW + 30 * 60_000)
  })

  it("starts the wait over once a handler succeeds", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    quiet()
    const { port, deadlines } = clock(new Map([["reap", NOW - 1]]))
    await expect(runDue(port, ["reap"], { reap: fails })).rejects.toThrow(AggregateError)
    await runDue(port, ["reap"], { reap: () => {} })
    expect(deadlines.has("reap")).toBe(false)

    deadlines.set("reap", NOW + 1)
    await expect(runDue(port, ["reap"], { reap: fails })).rejects.toThrow(AggregateError)
    expect(deadlines.get("reap")).toBe(NOW + RECOVERY_DELAY_MS)
  })

  it("leaves a deadline the handler moved itself alone", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    quiet()
    const { port, deadlines } = clock(new Map([["reap", NOW - 1]]))
    const moved = NOW + 5_000
    const handler = async () => {
      await port.setWakeup("reap", moved)
      throw new Error("boom")
    }
    await expect(runDue(port, ["reap"], { reap: handler })).rejects.toThrow(AggregateError)
    expect(deadlines.get("reap")).toBe(moved)
  })

  it("clears the deadline a successful handler left alone", async () => {
    const { port, deadlines } = clock(new Map([["reap", NOW]]))
    await runDue(port, ["reap"], { reap: () => {} })
    expect(deadlines.has("reap")).toBe(false)
  })
})
