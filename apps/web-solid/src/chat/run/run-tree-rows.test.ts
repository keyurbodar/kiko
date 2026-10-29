import type { RunStep } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { groupSummary, stillFailing, summaryText } from "./run-tree-rows"

const START = Date.UTC(2024, 9, 24, 9)

function step(id: string, more: Partial<RunStep>): RunStep {
  return {
    id,
    runId: "run",
    slug: "kiko",
    tool: "run",
    name: "bash",
    label: `Ran ${id}`,
    status: "done",
    startedAt: START,
    endedAt: START + 1_000,
    after: 0,
    ...more,
  } as RunStep
}

describe("groupSummary", () => {
  it("counts each kind, capitalizes only the first word and marks failures last", () => {
    const steps = [
      step("one", { label: "Ran npm test" }),
      step("two", { label: "Ran npm build" }),
      step("three", { label: "Ran npm lint", status: "failed" }),
      step("edit", { tool: "edit", name: "edit", label: "Edited /src/app.tsx" }),
      step("read", { tool: "read", name: "read", label: "Read /src/app.tsx" }),
      step("read2", { tool: "read", name: "read", label: "Read /src/main.tsx" }),
      step("search", { tool: "search", name: "web_search", label: "Searched for hotels" }),
      step("browse", { tool: "web", name: "browse", label: "Browsed asakusa.jp" }),
    ]
    expect(summaryText(groupSummary(steps))).toBe(
      "Ran 3 commands, edited 1 file, read 2 files, searched 1 time, browsed 1 page, 1 failed",
    )
  })

  it("marks the failure segment so the view can paint it in the danger tier", () => {
    const segments = groupSummary([step("one", { status: "failed" })])
    expect(segments.at(-1)).toEqual({ text: "1 failed", failed: true })
  })

  it("counts a helper once, not once per step", () => {
    const worker = { id: "w1", task: "Trains helper" }
    const steps = [step("a", { worker, label: "Read timetable" }), step("b", { worker, label: "Read prices" })]
    expect(summaryText(groupSummary(steps))).toBe("Started 1 helper")
  })

  it("counts distinct edited paths once", () => {
    const steps = [
      step("a", { tool: "edit", name: "edit", label: "Edited /src/app.tsx" }),
      step("b", { tool: "edit", name: "edit", label: "Edited /src/app.tsx" }),
    ]
    expect(summaryText(groupSummary(steps))).toBe("Edited 1 file")
  })

  it("has nothing to say about an empty run", () => {
    expect(groupSummary([])).toEqual([])
  })

  it("stops counting a failure once that same step is retried and succeeds", () => {
    const steps = [
      step("first", { tool: "search", name: "web_search", label: "Searched hotels", status: "failed" }),
      step("retry", {
        tool: "search",
        name: "web_search",
        label: "Searched hotels",
        startedAt: START + 5_000,
      }),
    ]
    expect(summaryText(groupSummary(steps))).not.toContain("failed")
  })
})

describe("stillFailing", () => {
  const mine = { id: "w1", task: "Trains helper" }
  const other = { id: "w2", task: "Food helper" }

  it("clears a failure when the same step is retried and succeeds in the same helper", () => {
    const steps = [
      step("first", { worker: mine, name: "web_search", status: "failed" }),
      step("retry", { worker: mine, name: "web_search", startedAt: START + 5_000 }),
    ]
    expect(stillFailing(steps)).toBe(false)
  })

  it("keeps a failure when a different helper runs the same tool well afterwards", () => {
    const steps = [
      step("mine", { worker: mine, name: "web_search", status: "failed" }),
      step("theirs", { worker: other, name: "web_search", startedAt: START + 5_000 }),
    ]
    expect(stillFailing(steps)).toBe(true)
  })
})
