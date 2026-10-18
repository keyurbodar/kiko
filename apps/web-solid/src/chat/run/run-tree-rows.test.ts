import { describe, expect, test } from "bun:test"
import type { RunStep } from "@kiko/protocol"
import { treeOf } from "./run-tree-rows"

const step = (id: string, over: Partial<RunStep> = {}): RunStep => ({
  id,
  runId: "r1",
  slug: "kiko" as RunStep["slug"],
  tool: "run",
  name: "bash",
  label: "Ran ls",
  status: "done",
  startedAt: 1000,
  after: 0,
  ...over,
})

describe("treeOf rows open their details inline", () => {
  test("a call's row carries its input and output, and its failure", () => {
    const steps = [step("a", { input: "ls -la /tmp", output: "no such file", status: "failed" })]
    const { folded } = treeOf(steps, { working: false, open: true })
    expect(folded[0]?.id).toBe("a")
    expect(folded[0]?.detail).toEqual({ input: "ls -la /tmp", output: "no such file", failed: true, running: false })
  })

  test("a running call says so, with nothing to show yet", () => {
    const { shown } = treeOf([step("a", { status: "running" })], { working: true, open: false })
    expect(shown[0]?.detail).toMatchObject({ running: true, output: undefined })
  })

  test("a note has nothing to open", () => {
    const { shown } = treeOf([step("a", { note: true, label: "Looking into it" })], { working: true, open: false })
    expect(shown[0]?.detail).toBeUndefined()
  })
})
