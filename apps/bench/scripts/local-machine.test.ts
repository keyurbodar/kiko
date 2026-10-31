import { existsSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { LocalMachine } from "./local-machine"

const machines: LocalMachine[] = []

afterEach(async () => {
  await Promise.all(machines.splice(0).map((machine) => machine.cleanup().catch(() => undefined)))
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("LocalMachine", () => {
  it("stops the processes it started before removing the workdir", async () => {
    const machine = await LocalMachine.create("test-local")
    machines.push(machine)
    const child = await machine.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"])

    await machine.cleanup()
    machines.pop()

    expect(alive(child.pid)).toBe(false)
    expect(machine.children.size).toBe(0)
    expect(existsSync(machine.workdir)).toBe(false)
  })
})
