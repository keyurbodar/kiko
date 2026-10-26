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
  it("stops bash fetches with calls to spare, so the model can finish the step and the run continues fresh", () => {
    const budget = runs().budget()
    let spared = 0
    while (budget.spare()) spared++
    expect(spared).toBe(34)
    expect(budget.due()).toBe(true)
    for (let call = 0; call < 6; call++) budget.count()
    expect(() => budget.count()).toThrow()
  })

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

  it("tells a running agent to share as soon as another agent queues, and not before", async () => {
    const all = runs()
    let signal: AbortSignal | undefined
    let finish = () => {}
    const work = all.run("room:forge", "r1", async () => {
      signal = all.shared("room:forge")
      all.waiting("room:forge")
      expect(signal?.aborted).toBe(false)
      all.waiting("room:atelier")
      await new Promise<void>((resolve) => (finish = resolve))
      return "done"
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(signal?.aborted).toBe(true)
    finish()
    await work
    expect(all.shared("room:forge")).toBeUndefined()
  })
})
