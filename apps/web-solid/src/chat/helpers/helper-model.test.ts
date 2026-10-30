import type { RunStep } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { elapsed, helperLanes, helperTitle, nestedLanes, startedLabel } from "./helper-model"

let counter = 0

function step(over: Partial<RunStep> & { worker?: { id: string; task: string } }): RunStep {
  counter += 1
  return {
    id: `s${counter}`,
    runId: "r1",
    slug: "alpha",
    tool: "read",
    name: "read_file",
    label: "Read brief.md",
    status: "done",
    startedAt: 1000 * counter,
    endedAt: 1000 * counter + 500,
    after: 4,
    ...over,
  } as RunStep
}

const hero = { id: "w1", task: "Try 3 hero layouts for the landing page. Phones first." }
const icons = { id: "w2", task: "Draw 12 icons" }
const none = new Map<string, never>()
const awake = { busy: () => true, stale: false }

describe("helper lanes", () => {
  it("ignores steps that do not belong to a helper", () => {
    expect(helperLanes([step({})], none, awake)).toEqual([])
  })

  it("groups helper steps into one lane per helper in start order", () => {
    const lanes = helperLanes(
      [step({ worker: hero }), step({ worker: icons }), step({ worker: hero }), step({})],
      none,
      awake,
    )
    expect(lanes.map((lane) => [lane.id, lane.count])).toEqual([
      ["w1", 2],
      ["w2", 1],
    ])
    expect(lanes[0]).toMatchObject({ slug: "alpha", window: "alpha#4" })
  })

  it("is working while a step runs, and shows what it is doing", () => {
    const [lane] = helperLanes(
      [
        step({ worker: hero }),
        step({ worker: hero, status: "running", name: "write_file", tool: "edit", label: "Wrote hero.html" }),
      ],
      none,
      awake,
    )
    expect(lane?.state).toBe("working")
    expect(lane?.endedAt).toBeUndefined()
    expect(lane?.line).toBe("Writing hero.html")
  })

  it("is working between steps while the agent still lists it as pending or running", () => {
    for (const status of ["pending", "running"] as const) {
      const [lane] = helperLanes([step({ worker: hero })], new Map([["w1", status]]), awake)
      expect(lane?.state).toBe("working")
    }
  })

  it("is not working once its agent is idle, even if a step never reported its end", () => {
    const [lane] = helperLanes([step({ worker: hero, status: "running", endedAt: undefined })], none, {
      busy: () => false,
      stale: false,
    })
    expect(lane?.state).toBe("done")
    expect(lane?.endedAt).toBeUndefined()
  })

  it("keeps a working helper working while the chat is offline, then shows its real end", () => {
    const steps = [
      step({ worker: hero }),
      step({ worker: hero, status: "running", endedAt: undefined, name: "write_file", label: "Wrote hero.html" }),
    ]
    const offline = helperLanes(steps, none, { busy: () => false, stale: true })
    expect(offline[0]?.state).toBe("working")
    expect(offline[0]?.line).toBe("Writing hero.html")

    const back = helperLanes(steps, new Map([["w1", "done"]]), { busy: () => false, stale: false })
    expect(back[0]?.state).toBe("done")
  })

  it("is done when every step finished, and ends at the last step", () => {
    const steps = [step({ worker: hero }), step({ worker: hero })]
    const [lane] = helperLanes(steps, none, awake)
    expect(lane?.state).toBe("done")
    expect(lane?.endedAt).toBe(steps[1]!.endedAt)
  })

  it("fails only when a failed step was not retried successfully", () => {
    const failed = step({ worker: hero, status: "failed", name: "read_file", startedAt: 10 })
    expect(helperLanes([failed], none, awake)[0]?.state).toBe("failed")
    const retried = step({ worker: hero, name: "read_file", startedAt: 20 })
    expect(helperLanes([failed, retried], none, awake)[0]?.state).toBe("done")
  })

  it("trusts the agent's finished status over a step it recovered from", () => {
    const failed = step({ worker: hero, status: "failed", name: "read_file", startedAt: 10 })
    const [lane] = helperLanes([failed], new Map([["w1", "done"]]), awake)
    expect(lane?.state).toBe("done")
  })

  it("trusts the agent's failure over steps that all look finished", () => {
    const [lane] = helperLanes([step({ worker: hero })], new Map([["w1", "failed"]]), awake)
    expect(lane?.state).toBe("failed")
  })

  it("is stopped when the agent reports it stopped, even if a step was left running", () => {
    const [lane] = helperLanes([step({ worker: hero, status: "running" })], new Map([["w1", "stopped"]]), awake)
    expect(lane?.state).toBe("stopped")
  })

  it("nests only the helpers of the newest run of agents that are still busy", () => {
    const lanes = helperLanes(
      [
        step({ worker: hero, after: 2 }),
        step({ worker: icons, after: 8 }),
        step({ worker: { id: "w3", task: "Other" }, slug: "kiko" as RunStep["slug"], after: 1 }),
      ],
      none,
      awake,
    )
    expect(nestedLanes(lanes, (slug) => slug === "alpha").map((lane) => lane.id)).toEqual(["w2"])
    expect(nestedLanes(lanes, () => false)).toEqual([])
  })
})

describe("helper wording", () => {
  it("titles a helper by the first words of its brief", () => {
    expect(helperTitle(hero.task)).toBe("Try 3 hero layouts for…")
    expect(helperTitle("Check copy.")).toBe("Check copy")
    expect(helperTitle("  Write the README\nthen ship it")).toBe("Write the README")
  })

  it("counts helpers in the lane header", () => {
    expect(startedLabel(1)).toBe("Started a helper")
    expect(startedLabel(3)).toBe("Started 3 helpers")
  })

  it("formats elapsed time", () => {
    expect(elapsed(40_000)).toBe("40s")
    expect(elapsed(125_000)).toBe("2m")
    expect(elapsed(3_900_000)).toBe("1h 5m")
    expect(elapsed(-5)).toBe("0s")
  })
})
