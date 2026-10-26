import { describe, expect, it } from "vitest"
import { Runs } from "./runs"

const runs = (scheduled: [string, boolean | undefined][] = [], halted: string[] = []) =>
  new Runs({
    schedule: async (agent, _requestId, behind) => {
      scheduled.push([agent, behind])
    },
    halt: async (agent) => {
      halted.push(agent)
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

  it("keeps a run that hit the call limit inside a tool able to yield, so the next model call is not refused", () => {
    const budget = runs().budget()
    for (let call = 0; call < 40; call++) budget.count()
    expect(() => budget.count()).toThrow()
    expect(budget.due()).toBe(true)
  })

  it("ends a request after three continuations instead of queuing a fourth", async () => {
    const scheduled: [string, boolean | undefined][] = []
    const halted: string[] = []
    const all = runs(scheduled, halted)
    await all.run("room:forge", "r1", async () => "continue", 2)
    expect(scheduled).toEqual([["room:forge", true]])
    expect(halted).toEqual([])
    await all.run("room:forge", "r1", async () => "continue", 3)
    expect(scheduled).toHaveLength(1)
    expect(halted).toEqual(["room:forge"])
    await all.run("room:forge", "r1", async () => "done", 3)
    expect(halted).toEqual(["room:forge"])
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
