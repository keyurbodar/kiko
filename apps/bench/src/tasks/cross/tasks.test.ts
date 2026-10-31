import { describe, expect, it } from "vitest"

import { createMachine, localOs, removeMachine } from "../../machine"
import type { Task } from "../../types"
import { crossTasks } from "./registry"

const currentOs = localOs()
const runsHere = (task: Task): boolean => task.os.includes(currentOs)

async function expectOraclePasses(task: Task): Promise<void> {
  const machine = await createMachine()
  try {
    await task.setup(machine, 1)
    await task.oracle(machine, 1)
    const verdict = await task.check(machine, 1)
    expect(verdict.checks.length).toBeGreaterThan(0)
    expect(verdict.checks.every((check) => check.pass)).toBe(true)
    expect(verdict.pass).toBe(true)
  } finally {
    await removeMachine(machine)
  }
}

async function expectSetupAloneFails(task: Task): Promise<void> {
  const machine = await createMachine()
  try {
    await task.setup(machine, 1)
    const verdict = await task.check(machine, 1)
    expect(verdict.pass).toBe(false)
  } finally {
    await removeMachine(machine)
  }
}

describe("cross tasks", () => {
  for (const task of crossTasks) {
    it.skipIf(!runsHere(task))(`${task.id} passes with the oracle`, () => expectOraclePasses(task))
    it.skipIf(!runsHere(task))(`${task.id} fails without the oracle`, () => expectSetupAloneFails(task))
  }
})
