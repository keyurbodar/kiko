import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createMachine, localOs, removeMachine } from "../../machine"
import type { Task } from "../../types"
import { countMatches } from "./count-matches"
import { fixScript } from "./fix-script"
import { gitBranch } from "./git-branch"
import { terminalTasksC } from "./registry-c"

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
  it.skipIf(!runsHere(countMatches))("terminal-025-count-matches passes with the oracle", () =>
    expectOraclePasses(countMatches),
  )
  it.skipIf(!runsHere(countMatches))("terminal-025-count-matches fails without the oracle", () =>
    expectSetupAloneFails(countMatches),
  )
  it.skipIf(!runsHere(fixScript))("terminal-026-fix-script passes with the oracle", () => expectOraclePasses(fixScript))
  it.skipIf(!runsHere(fixScript))("terminal-026-fix-script fails without the oracle", () =>
    expectSetupAloneFails(fixScript),
  )
  it.skipIf(!runsHere(gitBranch))("terminal-027-git-branch passes with the oracle", () => expectOraclePasses(gitBranch))
  it.skipIf(!runsHere(gitBranch))("terminal-027-git-branch fails without the oracle", () =>
    expectSetupAloneFails(gitBranch),
  )

  it("terminal-025-count-matches accepts a count written as UTF-16", async () => {
    const machine = await createMachine()
    try {
      await machine.writeText(join(machine.workdir, "count.txt"), "\uFFFD\uFFFD3\u0000\r\u0000\n\u0000")
      const verdict = await countMatches.check(machine, 1)
      expect(verdict.pass).toBe(true)
    } finally {
      await removeMachine(machine)
    }
  })
})

describe("harder terminal tasks", () => {
  for (const task of terminalTasksC) {
    it.skipIf(!runsHere(task))(`${task.id} passes with the oracle`, () => expectOraclePasses(task))
    it.skipIf(!runsHere(task))(`${task.id} fails without the oracle`, () => expectSetupAloneFails(task))
  }
})
