import { afterEach, describe, expect, it } from "vitest"
import { clearGitHookEnv, createMachine, localOs, removeMachine } from "./machine"
import type { Machine } from "./types"

const machines: Machine[] = []

afterEach(async () => {
  await Promise.all(machines.splice(0).map((machine) => removeMachine(machine)))
})

describe("machine", () => {
  it("strips a git hook's environment from commands", async () => {
    const machine = await createMachine("test-machine")
    machines.push(machine)
    const out = await machine.exec(["/bin/sh", "-c", 'printf %s "${GIT_DIR-unset}"'], {
      env: { GIT_DIR: "/somewhere/else" },
    })
    expect(out.stdout.trim()).toBe("unset")
  })

  it("clears the git hook variables from a process environment", () => {
    const env: NodeJS.ProcessEnv = { GIT_DIR: "/x", GIT_WORK_TREE: "/y", KEEP: "yes" }
    clearGitHookEnv(env)
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GIT_WORK_TREE).toBeUndefined()
    expect(env.KEEP).toBe("yes")
  })

  it("reads and writes text in the workdir", async () => {
    const machine = await createMachine("test-machine")
    machines.push(machine)
    const path = `${machine.workdir}/nested/file.txt`
    await machine.writeText(path, "hello\n")
    expect(await machine.readText(path)).toBe("hello\n")
    expect(await machine.readText(`${machine.workdir}/missing.txt`)).toBeUndefined()
  })

  it("reports the local OS", () => {
    expect(localOs("darwin")).toBe("macos")
    expect(localOs("linux")).toBe("linux")
  })

  it("spawns a process and stops it", async () => {
    const machine = await createMachine("test-machine")
    machines.push(machine)
    const child = await machine.spawn(["/bin/sh", "-c", "sleep 30"])
    expect(child.pid).toBeGreaterThan(0)
    await child.stop()
  })
})
