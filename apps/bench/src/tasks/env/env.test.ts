import { afterEach, describe, expect, it } from "vitest"
import { createMachine, removeMachine } from "../../machine"
import type { Machine, Task } from "../../types"
import { envTasks } from "."

const machines: Machine[] = []

afterEach(async () => {
  await Promise.all(machines.splice(0).map((machine) => removeMachine(machine)))
})

async function checked(task: Task, solve: boolean): Promise<boolean> {
  const machine = await createMachine("test-env")
  machines.push(machine)
  await task.setup(machine, 1)
  if (solve) await task.oracle(machine, 1)
  const verdict = await task.check(machine, 1)
  return verdict.pass
}

describe("environment tasks", () => {
  for (const task of envTasks) {
    it(`${task.id} passes its oracle and fails when nothing runs`, async () => {
      expect(await checked(task, true)).toBe(true)
      expect(await checked(task, false)).toBe(false)
    })

    it(`${task.id} only runs against kiko-remote`, () => {
      expect(task.contenders).toEqual(["kiko-remote"])
      expect(task.track).toBe("environment")
    })
  }
})
