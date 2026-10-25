import { describe, expect, it } from "vitest"
import { Runs } from "./runs"

const runs = (scheduled: [string, boolean | undefined][] = []) =>
  new Runs({
    schedule: async (agent, _requestId, behind) => {
      scheduled.push([agent, behind])
    },
    now: () => 0,
  })

describe("run budget", () => {
  it("keeps running alone, and yields to a waiting agent once it has made progress", () => {
    const budget = runs().budget()
    let waiting = true
    expect(budget.due(() => waiting)).toBe(false)
    budget.count()
    budget.count()
    budget.count()
    expect(budget.due(() => waiting)).toBe(true)
    waiting = false
    expect(budget.due(() => waiting)).toBe(false)
  })

  it("puts a run that yielded behind the agents already waiting", async () => {
    const scheduled: [string, boolean | undefined][] = []
    await runs(scheduled).run("room:forge", "r1", async () => "continue")
    expect(scheduled).toEqual([["room:forge", true]])
  })
})
