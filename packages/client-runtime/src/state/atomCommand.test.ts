import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { createRuntimeCommand, executeAtomQuery, runAtomCommand } from "./atomCommand"

const runtime = Atom.runtime(Layer.empty)

const gate = () => {
  let open = () => {}
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

describe("atom commands", () => {
  it("run one single-flight command per key and hand every caller its result", async () => {
    const registry = AtomRegistry.make()
    const release = gate()
    let runs = 0
    const command = createRuntimeCommand(runtime, {
      label: "test.pair",
      concurrency: { mode: "singleFlight", key: () => "pair" },
      execute: () =>
        Effect.promise(async () => {
          runs++
          await release.opened
          return runs
        }),
    })
    const first = runAtomCommand(registry, command, undefined)
    const second = runAtomCommand(registry, command, undefined)
    release.open()
    const results = await Promise.all([first, second])
    expect(runs).toBe(1)
    expect(results.map((r) => (r._tag === "Success" ? r.value : null))).toEqual([1, 1])
    const third = await runAtomCommand(registry, command, undefined)
    expect(third._tag === "Success" ? third.value : null).toBe(2)
  })

  it("run serial commands for one key in order", async () => {
    const registry = AtomRegistry.make()
    const order: string[] = []
    const release = gate()
    const command = createRuntimeCommand(runtime, {
      label: "test.serial",
      concurrency: { mode: "serial", key: (input: { room: string; step: string }) => input.room },
      execute: (input: { room: string; step: string }) =>
        Effect.promise(async () => {
          if (input.step === "a") await release.opened
          order.push(input.step)
        }),
    })
    const a = runAtomCommand(registry, command, { room: "r", step: "a" })
    const b = runAtomCommand(registry, command, { room: "r", step: "b" })
    release.open()
    await Promise.all([a, b])
    expect(order).toEqual(["a", "b"])
  })

  it("settle a failing command as a Failure instead of throwing", async () => {
    const registry = AtomRegistry.make()
    const command = createRuntimeCommand(runtime, {
      label: "test.fail",
      concurrency: { mode: "parallel" },
      execute: () => Effect.fail("refused" as const),
    })
    const warned: string[] = []
    const reporter = { warn: (message: string) => void warned.push(message), error: () => {} }
    const result = await runAtomCommand(registry, command, undefined, reporter)
    expect(result._tag).toBe("Failure")
    expect(warned).toEqual(["[atom-command] test.fail failed"])
  })

  it("read a query atom once, and read it again on refresh", async () => {
    const registry = AtomRegistry.make()
    let reads = 0
    const atom = Atom.make(Effect.sync(() => ++reads))
    const first = await executeAtomQuery(registry, atom)
    const again = await executeAtomQuery(registry, atom, { refresh: true })
    expect(first._tag === "Success" ? first.value : null).toBe(1)
    expect(again._tag === "Success" ? again.value : null).toBe(2)
  })
})
