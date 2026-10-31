import type { ComputerSummary } from "@kiko/protocol"
import { assert, describe, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import {
  computerMatches,
  describeComputer,
  diagnose,
  failureMessage,
  readDaemonLog,
  waitForComputer,
  WAIT_BUDGET,
} from "./pc-add"

const CAPS = { shell: true, files: true, desktop: false, live: false, input: false }

function pc(over: Partial<ComputerSummary> = {}): ComputerSummary {
  return {
    id: "pc1",
    name: "box",
    os: "linux",
    online: true,
    caps: CAPS,
    holder: "agent",
    displays: [],
    background: false,
    browsers: [],
    ...over,
  } as ComputerSummary
}

describe("readDaemonLog", () => {
  it("sees a welcomed daemon", () => {
    const readings = readDaemonLog(["[info] the worker calls this machine mac"])
    assert.isTrue(readings.welcomed)
  })

  it("sees an unreachable worker", () => {
    const readings = readDaemonLog([
      "[error] cannot reach wss://kiko.example.com/api/pc/connect: getaddrinfo ENOTFOUND",
    ])
    assert.isTrue(readings.cannotReach?.includes("cannot reach"))
  })

  it("sees a refused pairing", () => {
    const readings = readDaemonLog(["[error] the worker refused the connection: 403 Forbidden"])
    assert.isTrue(readings.refused?.includes("refused"))
  })

  it("sees a protocol mismatch", () => {
    const readings = readDaemonLog([
      "[error] that worker speaks computer protocol 9 and this daemon speaks 8; update one of them",
    ])
    assert.isTrue(readings.protocol?.includes("protocol"))
  })
})

describe("diagnose", () => {
  it("names an unreachable worker before a refused one", () => {
    const readings = readDaemonLog([
      "[error] cannot reach wss://kiko.example.com: DNS failure",
      "[error] the worker refused the connection: 403",
    ])
    assert.strictEqual(diagnose("log", readings).reason, "unreachable")
  })

  it("names a refused pairing", () => {
    const readings = readDaemonLog(["[error] the worker refused the connection: 403 Forbidden"])
    assert.strictEqual(diagnose("log", readings).reason, "refused")
  })

  it("names a machine that cannot keep a daemon when there is no log", () => {
    assert.strictEqual(diagnose(null, readDaemonLog([])).reason, "unkept")
  })

  it("shows the log when the daemon was welcomed but never came online", () => {
    const readings = readDaemonLog(["[info] the worker calls this machine mac"])
    const result = diagnose("log", readings)
    assert.strictEqual(result.reason, "started")
    assert.isTrue(result.detail?.includes("never came online"))
  })

  it("shows the log tail when the daemon simply did not start", () => {
    const result = diagnose("last lines here", readDaemonLog([]))
    assert.strictEqual(result.reason, "started")
    assert.strictEqual(result.detail, "last lines here")
  })

  it("explains the unsupported machine plainly", () => {
    const message = failureMessage({ reason: "unkept", detail: "no daemon log exists on the machine" }, "ci@runner")
    assert.isTrue(message.includes("not a supported environment"))
    assert.isTrue(message.includes("systemd --user or launchd"))
  })
})

describe("waitForComputer", () => {
  it("returns a new online computer once the worker reports it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = Stream.fromIterable([
          [pc({ id: "old", name: "old-box" })],
          [pc({ id: "old", name: "old-box" }), pc({ id: "new", name: "new-box" })],
        ])
        const fiber = yield* waitForComputer(stream, { known: new Set(["old"]) }).pipe(Effect.forkChild)
        const found = yield* Fiber.join(fiber)
        assert.strictEqual(found.id, "new")
      }),
    ))

  it("matches the --name the owner gave", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = Stream.fromIterable([[pc({ id: "old", name: "builder" })]])
        const found = yield* waitForComputer(stream, { name: "builder", known: new Set(["old"]) })
        assert.strictEqual(found.name, "builder")
      }),
    ))

  it("fails after the budget when nothing arrives", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* waitForComputer(Stream.never, { known: new Set() }).pipe(Effect.forkChild)
        yield* TestClock.adjust(WAIT_BUDGET)
        const exit = yield* Fiber.await(fiber)
        assert.isTrue(exit._tag === "Failure")
      }).pipe(Effect.provide(TestClock.layer())),
    ))

  it("ignores a computer that is offline", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = Stream.fromIterable([[pc({ id: "new", online: false })]])
        const fiber = yield* waitForComputer(stream, { known: new Set() }).pipe(Effect.forkChild)
        yield* TestClock.adjust(WAIT_BUDGET)
        const exit = yield* Fiber.await(fiber)
        assert.isTrue(exit._tag === "Failure")
      }).pipe(Effect.provide(TestClock.layer())),
    ))
})

describe("describeComputer", () => {
  it("names the machine, os and capabilities", () => {
    const text = describeComputer(
      pc({ name: "mac", os: "macos", caps: { shell: true, files: true, desktop: true, live: true, input: true } }),
    )
    assert.strictEqual(text, "mac (macos): shell, files, desktop, input, live")
  })

  it("matches a known id only by --name", () => {
    assert.isFalse(computerMatches(pc({ id: "old" }), { known: new Set(["old"]) }))
    assert.isTrue(computerMatches(pc({ id: "old", name: "builder" }), { name: "builder", known: new Set(["old"]) }))
  })
})
