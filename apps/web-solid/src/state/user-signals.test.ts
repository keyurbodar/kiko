import { describe, expect, it } from "vitest"
import type { RoomId, UserSignal } from "@kiko/protocol"
import { createUserSignals } from "./user-signals"

const computers = (names: readonly string[]) =>
  ({
    t: "pcState",
    computers: names.map((name) => ({
      id: name,
      name,
      os: "macos",
      online: true,
      caps: { shell: true, files: true, desktop: false, live: false, input: false },
      holder: "agent",
      busy: false,
      displays: [],
      background: false,
      browsers: [],
    })),
  }) as UserSignal

describe("user signals", () => {
  it("gives a late listener the computer list that arrived before it", () => {
    const signals = createUserSignals()
    signals.deliver(computers(["mac"]))
    const seen: string[][] = []
    signals.on("pcState", (signal) => seen.push(signal.computers.map((c) => c.name)))
    signals.deliver(computers(["mac", "linux"]))
    expect(seen).toEqual([["mac"], ["mac", "linux"]])
  })

  it("does not replay one-off signals to a late listener", () => {
    const signals = createUserSignals()
    signals.deliver({ t: "typing", roomId: "r1" as RoomId, names: ["kiko"] })
    const seen: unknown[] = []
    signals.on("typing", (signal) => seen.push(signal))
    expect(seen).toEqual([])
  })

  it("stops calling a listener once it unsubscribes", () => {
    const signals = createUserSignals()
    const seen: unknown[] = []
    const off = signals.on("pcState", (signal) => seen.push(signal))
    off()
    signals.deliver(computers(["mac"]))
    expect(seen).toEqual([])
  })
})
