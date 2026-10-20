import { expect, test } from "bun:test"
import { RunBudget, RUN_DURATION_MS, Runs } from "../src/owner/runs"

test("budgets expire at 40 actual calls or the twelve minute deadline", () => {
  let now = 100
  const budget = new RunBudget(() => now)
  for (let n = 0; n < 39; n++) budget.count()
  expect(budget.due()).toBe(false)
  budget.count()
  expect(budget.due()).toBe(true)
  const timed = new RunBudget(() => now)
  now += RUN_DURATION_MS - 1
  expect(timed.due()).toBe(false)
  now++
  expect(timed.due()).toBe(true)
})

test("duplicate deliveries share one invocation and each continuation crosses the clock", async () => {
  const scheduled: string[] = []
  const runs = new Runs({ schedule: async (agent, id) => { scheduled.push(`${agent}/${id}`) } })
  await runs.start("a", "input")
  const release = Promise.withResolvers<"continue">()
  let invoked = 0
  const first = runs.run("a", "input", async (budget) => {
    invoked++
    runs.count("a")
    expect(budget.calls).toBe(1)
    return release.promise
  })
  const duplicate = runs.run("a", "input", async () => { throw new Error("duplicate") })
  expect(duplicate).toBe(first)
  release.resolve("continue")
  await first
  expect(invoked).toBe(1)
  expect(scheduled).toEqual(["a/input", "a/input"])
  await runs.run("a", "input", async (budget) => { expect(budget.calls).toBe(0); return "done" })
  expect(scheduled).toHaveLength(2)
})

test("a failure never schedules more work and does not retain its invocation budget", async () => {
  const scheduled: string[] = []
  const runs = new Runs({ schedule: async (agent) => { scheduled.push(agent) } })
  await expect(runs.run("a", "input", async () => { throw new Error("failed") })).rejects.toThrow("failed")
  expect(scheduled).toEqual([])
  await runs.run("a", "next", async (budget) => { expect(budget.calls).toBe(0); return "done" })
})

test("parallel attempts reserve at most 40 network admissions before any fetch", async () => {
  const budget = new RunBudget()
  let fetched = 0
  const results = await Promise.allSettled(Array.from({ length: 60 }, async () => {
    budget.count()
    fetched++
    await Promise.resolve()
  }))
  expect(fetched).toBe(40)
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(20)
  expect(budget.calls).toBe(40)
  expect(budget.due()).toBe(false)
})

test("one multi-fetch tool preserves completed effects and rejects before its next request", () => {
  const budget = new RunBudget()
  const effects: number[] = []
  expect(() => {
    for (let n = 0; n < 60; n++) {
      budget.count()
      effects.push(n)
    }
  }).toThrow("Completed actions were kept")
  expect(effects).toEqual(Array.from({ length: 40 }, (_, n) => n))
  expect(budget.due()).toBe(false)
})

test("concurrent admission queues tickets while one owner invocation executes", async () => {
  const tickets: string[] = []
  const runs = new Runs({ schedule: async (agent) => { tickets.push(agent) } })
  await Promise.all(Array.from({ length: 20 }, (_, n) => runs.start(`agent-${n}`, "input")))
  expect(tickets).toHaveLength(20)
  const hold = Promise.withResolvers<"done">()
  const active = runs.run("agent-0", "input", async () => hold.promise)
  await expect(runs.run("agent-1", "input", async () => "done")).rejects.toThrow("already active")
  hold.resolve("done")
  await active
  await runs.run("agent-1", "input", async () => "done")
})
