import { describe, expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ToDaemon } from "@kiko/computer/wire"
import { failed, installed, NO_ATTEMPTS, nextStep, started, type Attempts } from "./update"

const NOW = 1_000_000

function step(attempts: Attempts, served: string | undefined, options: { busy?: boolean; now?: number } = {}) {
  return nextStep(attempts, { served, running: "0.8.2", busy: options.busy ?? false, now: options.now ?? NOW })
}

describe("daemon update decision", () => {
  it("stays on a worker that serves this version or names none", () => {
    expect(step(NO_ATTEMPTS, "0.8.2")).toEqual({ kind: "stay" })
    expect(step(NO_ATTEMPTS, undefined)).toEqual({ kind: "stay" })
  })

  it("installs a different served version once per process", () => {
    expect(step(NO_ATTEMPTS, "0.9.0")).toEqual({ kind: "install", version: "0.9.0" })
    expect(step(started(NO_ATTEMPTS, "0.9.0"), "0.9.0")).toEqual({ kind: "stay" })
  })

  it("waits for running calls before installing and before restarting", () => {
    expect(step(NO_ATTEMPTS, "0.9.0", { busy: true })).toEqual({ kind: "idle" })
    const done = installed(started(NO_ATTEMPTS, "0.9.0"), "0.9.0")
    expect(step(done, "0.9.0", { busy: true })).toEqual({ kind: "idle" })
    expect(step(done, "0.9.0")).toEqual({ kind: "restart", version: "0.9.0" })
  })

  it("backs off after a failed install and never retries the same version", () => {
    const after = failed(started(NO_ATTEMPTS, "0.9.0"), NOW)
    expect(step(after, "0.9.0", { now: NOW + 365 * 86_400_000 })).toEqual({ kind: "stay" })
    const wait = step(after, "0.9.1")
    expect(wait.kind).toBe("wait")
    const until = wait.kind === "wait" ? wait.until : 0
    expect(until).toBeGreaterThan(NOW)
    expect(step(after, "0.9.1", { now: until })).toEqual({ kind: "install", version: "0.9.1" })
    const twice = failed(started(after, "0.9.1"), until)
    const longer = step(twice, "0.9.2", { now: until })
    expect(longer.kind === "wait" && longer.until - until).toBeGreaterThan(until - NOW)
  })
})

describe("welcome frame", () => {
  it("still decodes when the worker adds fields this daemon does not know", () => {
    const decoded = Schema.decodeUnknownOption(ToDaemon)({
      t: "welcome",
      id: "pc-1",
      name: "box",
      version: "0.9.0",
      later: { anything: true },
    })
    expect(Option.getOrUndefined(decoded)).toEqual({ t: "welcome", id: "pc-1", name: "box", version: "0.9.0" })
  })
})
