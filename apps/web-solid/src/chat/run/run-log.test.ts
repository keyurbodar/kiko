import { describe, expect, test } from "bun:test"
import type { RunStep, ToolKind } from "@kiko/protocol"
import { extraInput, formatClock, formatDuration, iconOf, liveLabel, programOf, summarizeSteps, totalDuration, upsertStep } from "./run-log"

const step = (id: string, over: Partial<RunStep> = {}): RunStep => ({
  id,
  runId: "r1",
  slug: "kiko" as RunStep["slug"],
  tool: "read",
  label: "Read /a.md",
  status: "done",
  startedAt: 1000,
  ...over,
})
const kinds = (...tools: ToolKind[]) => tools.map((tool) => ({ tool, status: "done" as const }))

describe("summarizeSteps", () => {
  const table: [string, ToolKind[], string][] = [
    ["one read", ["read"], "Read 1 file"],
    ["commands and reads, in order of first use", ["run", "run", "run", "read", "read"], "Ran 3 commands and read 2 files"],
    ["order follows first appearance", ["read", "read", "run"], "Read 2 files and ran 1 command"],
    ["edits are changes", ["edit", "edit"], "Changed 2 files"],
    ["web and code search are told apart", ["web", "search", "search"], "Searched the web 1 time and searched code 2 times"],
    ["a third kind folds into other actions", ["run", "edit", "read", "read"], "Ran 1 command, changed 1 file, and performed 2 other actions"],
    ["priority drops the least important kinds", ["other", "other", "read", "run"], "Read 1 file, ran 1 command, and performed 2 other actions"],
    ["other tools only", ["other"], "Used 1 tool"],
  ]
  for (const [name, tools, want] of table) test(name, () => expect(summarizeSteps(kinds(...tools)).summary).toBe(want))

  test("flags a failure", () => {
    expect(summarizeSteps([{ tool: "run", status: "failed" }]).hasFailure).toBe(true)
    expect(summarizeSteps(kinds("run")).hasFailure).toBe(false)
  })
})

describe("liveLabel", () => {
  const table: [string, Partial<RunStep>, string][] = [
    ["read goes present", { label: "Read /plan.md", status: "running" }, "Reading /plan.md"],
    ["edit goes present", { tool: "edit", label: "Edited /a.ts", status: "running" }, "Editing /a.ts"],
    ["a command names its program", { tool: "run", label: "Ran bun test", input: "cd app && bun test --watch", status: "running" }, "Running bun"],
    ["a command without input reads the label", { tool: "run", label: "Ran bun test", status: "running" }, "Running bun"],
    ["an unknown verb stays as written", { tool: "other", label: "Pondered it", status: "running" }, "Pondered it"],
    ["a finished step keeps its label", { label: "Read /plan.md", status: "done" }, "Read /plan.md"],
    ["a failed step keeps its label", { tool: "run", label: "Ran bun test", status: "failed" }, "Ran bun test"],
  ]
  for (const [name, over, want] of table) test(name, () => expect(liveLabel(step("a", over))).toBe(want))
})

test("programOf skips directory changes, assignments, and wrappers", () => {
  expect(programOf("cd app && FOO=1 sudo /usr/bin/bun test")).toBe("bun")
  expect(programOf("cd app")).toBeUndefined()
})

test("extraInput only shows what the label hides", () => {
  expect(extraInput({ label: "Ran bun test", input: "bun test" })).toBeUndefined()
  expect(extraInput({ label: "Read /a.md", input: "/a.md" })).toBeUndefined()
  expect(extraInput({ label: "Ran bun test", input: "cd app && bun test --bail" })).toBe("cd app && bun test --bail")
  expect(extraInput({ label: "Ran bun test" })).toBeUndefined()
})

test("a failed step shows the alert glyph", () => {
  expect(iconOf({ tool: "run", status: "failed" })).toBe("alert")
  expect(iconOf({ tool: "run", status: "done" })).toBe("terminal")
  expect(iconOf({ tool: "web", status: "running" })).toBe("globe")
})

describe("durations", () => {
  const table: [number, string][] = [
    [420, "420ms"],
    [3400, "3.4s"],
    [42_000, "42s"],
    [65_000, "1m 5s"],
    [3_780_000, "1h 3m"],
  ]
  for (const [ms, want] of table) test(`${ms} ms is ${want}`, () => expect(formatDuration(ms)).toBe(want))
  test("the clock counts whole seconds", () => {
    expect(formatClock(0)).toBe("0s")
    expect(formatClock(12_900)).toBe("12s")
    expect(formatClock(65_000)).toBe("1m 5s")
  })
  test("total runs from the first start to the last end, and waits for running steps", () => {
    expect(totalDuration([step("a", { startedAt: 1000, endedAt: 2000 }), step("b", { startedAt: 1500, endedAt: 5000 })])).toBe(4000)
    expect(totalDuration([step("a", { endedAt: 2000 }), step("b", { status: "running" })])).toBeUndefined()
  })
})

describe("upsertStep", () => {
  test("keeps start order", () => {
    let list: RunStep[] = []
    list = upsertStep(list, step("b", { startedAt: 2000 }))
    list = upsertStep(list, step("a", { startedAt: 1000 }))
    list = upsertStep(list, step("c", { startedAt: 2000 }))
    expect(list.map((s) => s.id)).toEqual(["a", "b", "c"])
  })
  test("a done frame replaces the running one", () => {
    const list = upsertStep([step("a", { status: "running" })], step("a", { status: "done", output: "ok", endedAt: 1200 }))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: "done", output: "ok" })
  })
  test("a stale running frame never overwrites a done step", () => {
    const done = step("a", { status: "done", output: "ok", endedAt: 1200 })
    const list = upsertStep([done], step("a", { status: "running" }))
    expect(list[0]).toEqual(done)
  })
  test("a failed step stays failed against a late running frame", () => {
    const failed = step("a", { status: "failed", output: "boom" })
    expect(upsertStep([failed], step("a", { status: "running" }))[0].status).toBe("failed")
  })
})
