import { describe, expect, test } from "vitest"
import type { Os, Task } from "../types"
import { tasks } from "./index"
import { createMachine } from "./machine"

const currentOs = (): Os =>
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

const SEED = 7
const os = currentOs()
const hasDisplay = os !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

type Case = { readonly task: Task; readonly kind: "oracle" | "null" }

const cases: Case[] = tasks.flatMap((task) => {
  const covered = task.os.includes(os) && (!task.needs.includes("display") || hasDisplay)
  if (!covered) return []
  return [
    { task, kind: "oracle" as const },
    { task, kind: "null" as const },
  ]
})

describe.each(cases)("$task.id $kind", ({ task, kind }) => {
  test(kind === "oracle" ? "passes with the oracle" : "fails when nothing is done", async () => {
    const machine = await createMachine()
    try {
      await task.setup(machine, SEED)
      if (kind === "oracle") await task.oracle(machine, SEED)
      const verdict = await task.check(machine, SEED)
      if (kind === "oracle") {
        expect(verdict.checks.filter((entry) => !entry.pass)).toEqual([])
        expect(verdict.pass).toBe(true)
      } else {
        expect(verdict.pass).toBe(false)
      }
    } finally {
      await machine.dispose()
    }
  })
})
