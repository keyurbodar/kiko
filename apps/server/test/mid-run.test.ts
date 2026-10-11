import { describe, expect, test } from "bun:test"
import { type Arrival, decide, MAX_RESTARTS, type MidRunAction, type RunState } from "@yuki/agent/mid-run"

const run = (patch: Partial<RunState> = {}): RunState => ({
  bubblePosted: false,
  toolStarted: false,
  toolRunning: false,
  queued: false,
  restarts: 0,
  ...patch,
})

const human: Arrival = { kind: "human" }
const agent: Arrival = { kind: "agent" }
const system: Arrival = { kind: "system" }

const rows: [string, RunState | null, Arrival, MidRunAction][] = [
  ["no bubble and no tool: restart", run(), human, "restart"],
  ["a tool is running: steer", run({ toolStarted: true, toolRunning: true }), human, "steer"],
  ["a tool round finished: steer", run({ toolStarted: true }), human, "steer"],
  ["a bubble was posted, no tool running: steer, a human never waits for the run to end", run({ bubblePosted: true }), human, "steer"],
  ["a bubble was posted after a finished tool: steer", run({ bubblePosted: true, toolStarted: true }), human, "steer"],
  ["a bubble was posted and a tool is running: steer", run({ bubblePosted: true, toolStarted: true, toolRunning: true }), human, "steer"],
  ["idle: queue starts a run", null, human, "queue"],
  ["an agent message while busy: hold in the inbox", run(), agent, "hold"],
  ["a system message while busy: hold in the inbox", run({ toolRunning: true, toolStarted: true }), system, "hold"],
  ["an agent message when idle: queue starts a run", null, agent, "queue"],
  ["inputs already queued: steer, an abort would withdraw them", run({ queued: true }), human, "steer"],
  ["one restart so far: restart again", run({ restarts: 1 }), human, "restart"],
  ["the cap: the third arrival steers", run({ restarts: MAX_RESTARTS }), human, "steer"],
  ["past the cap: steer", run({ restarts: MAX_RESTARTS + 3 }), human, "steer"],
]

describe("decide", () => {
  for (const [name, state, arrival, action] of rows) {
    test(name, () => expect(decide(state, arrival)).toBe(action))
  }

  test("caps restarts at two per burst", () => {
    expect(MAX_RESTARTS).toBe(2)
    let restarts = 0
    const actions: MidRunAction[] = []
    for (let i = 0; i < 4; i++) {
      const action = decide(run({ restarts }), human)
      actions.push(action)
      if (action === "restart") restarts++
    }
    expect(actions).toEqual(["restart", "restart", "steer", "steer"])
  })

  test("a run that started a tool is never restarted, whatever else is true", () => {
    for (const bubblePosted of [false, true])
      for (const toolRunning of [false, true])
        for (const queued of [false, true])
          for (const restarts of [0, 1, 2])
            for (const arrival of [human, agent, system]) {
              expect(decide(run({ toolStarted: true, bubblePosted, toolRunning, queued, restarts }), arrival)).not.toBe("restart")
            }
  })

  test("a run that posted a bubble is never restarted", () => {
    for (const toolStarted of [false, true])
      for (const restarts of [0, 1]) expect(decide(run({ bubblePosted: true, toolStarted, restarts }), human)).not.toBe("restart")
  })
})
