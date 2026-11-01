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
  const cases = envTasks.map((task) => [task.id, task] as [string, Task])

  it.each(cases)("%s passes its oracle and fails when nothing runs", async (_id, task) => {
    expect(await checked(task, true)).toBe(true)
    expect(await checked(task, false)).toBe(false)
  })

  it.each(cases)("%s only runs against kiko-remote", (_id, task) => {
    expect(task.contenders).toEqual(["kiko-remote"])
    expect(task.track).toBe("environment")
  })
})
