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
  const dispatched: string[] = []
  const scheduled: string[] = []
  const runs = new Runs({ dispatch: async (agent, id) => { dispatched.push(`${agent}/${id}`) }, schedule: async (agent, id) => { scheduled.push(`${agent}/${id}`) } })
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
  expect(dispatched).toEqual(["a/input"])
  expect(scheduled).toEqual(["a/input"])
  await runs.run("a", "input", async (budget) => { expect(budget.calls).toBe(0); return "done" })
  expect(scheduled).toHaveLength(1)
})

test("a failure never schedules more work and does not retain its invocation budget", async () => {
  const scheduled: string[] = []
  const runs = new Runs({ dispatch: async () => {}, schedule: async (agent) => { scheduled.push(agent) } })
  await expect(runs.run("a", "input", async () => { throw new Error("failed") })).rejects.toThrow("failed")
  expect(scheduled).toEqual([])
  await runs.run("a", "next", async (budget) => { expect(budget.calls).toBe(0); return "done" })
})

test("alarm fallback queues the initial run without a self call", async () => {
  const scheduled: string[] = []
  const runs = new Runs({ policy: "alarm", dispatch: async () => { throw new Error("self-call") }, schedule: async (_agent, id) => { scheduled.push(id) } })
  await runs.start("a", "input")
  expect(scheduled).toEqual(["input"])
})
