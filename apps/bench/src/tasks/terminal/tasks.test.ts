import { describe, expect, it } from "vitest"

import { createMachine, localOs, removeMachine } from "../../machine"
import type { Task } from "../../types"
import { countMatches } from "./count-matches"
import { fixScript } from "./fix-script"
import { gitBranch } from "./git-branch"

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

describe("terminal tasks", () => {
  it.skipIf(!runsHere(countMatches))("terminal-001-count-matches passes with the oracle", () =>
    expectOraclePasses(countMatches),
  )
  it.skipIf(!runsHere(countMatches))("terminal-001-count-matches fails without the oracle", () =>
    expectSetupAloneFails(countMatches),
  )
  it.skipIf(!runsHere(fixScript))("terminal-002-fix-script passes with the oracle", () => expectOraclePasses(fixScript))
  it.skipIf(!runsHere(fixScript))("terminal-002-fix-script fails without the oracle", () =>
    expectSetupAloneFails(fixScript),
  )
  it.skipIf(!runsHere(gitBranch))("terminal-003-git-branch passes with the oracle", () => expectOraclePasses(gitBranch))
  it.skipIf(!runsHere(gitBranch))("terminal-003-git-branch fails without the oracle", () =>
    expectSetupAloneFails(gitBranch),
  )
})
