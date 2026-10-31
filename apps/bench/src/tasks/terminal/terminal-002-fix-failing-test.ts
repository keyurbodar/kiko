import type { Task } from "../../types"
import { check, LIMITS, readText, run, verdict, writeJson, writeText } from "../helpers"

const BUGGY = "export const sum = (a: number, b: number): number => a - b\n"

const FIXED = "export const sum = (a: number, b: number): number => a + b\n"

const TEST = `import { expect, test } from "bun:test"
import { sum } from "./sum"

test("adds positives", () => {
  expect(sum(2, 3)).toBe(5)
})

test("adds negatives", () => {
  expect(sum(-4, -6)).toBe(-10)
})

test("adds zero", () => {
  expect(sum(7, 0)).toBe(7)
})
`

export const fixFailingTest: Task = {
  id: "terminal-002-fix-failing-test",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt: "The tests in calc/ fail. Fix the bug in the code so `bun test calc` passes. Do not change the tests.",
  limits: LIMITS,
  setup: async (m) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "calc/sum.ts", BUGGY)
    await writeText(m, "calc/sum.test.ts", TEST)
  },
  oracle: async (m) => {
    await writeText(m, "calc/sum.ts", FIXED)
    await run(m, ["bun", "test", "calc"])
  },
  check: async (m) => {
    const result = await run(m, ["bun", "test", "calc"])
    const tests = await readText(m, "calc/sum.test.ts")
    return verdict([
      check("tests pass", result.code === 0, `bun test calc exited ${result.code}`),
      check("tests untouched", tests === TEST, `calc/sum.test.ts was ${JSON.stringify(tests)}`),
    ])
  },
}
