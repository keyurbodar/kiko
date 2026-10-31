import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { describe, expect, it, vi } from "vitest"
import { startTerminal } from "./terminalSession"

const state = vi.hoisted(() => ({
  handler: null as ((result: unknown) => void) | null,
  calls: [] as { command: string; input: unknown }[],
  stop: 0,
}))

vi.mock("../../state/runtime", () => ({
  observe: (_atom: unknown, handler: (result: unknown) => void) => {
    state.handler = handler
    return () => {
      state.stop += 1
    }
  },
  run: async (command: string, input: unknown) => {
    state.calls.push({ command, input })
    return { _tag: "Success", value: undefined }
  },
  owner: {
    terminalAtom: () => ({}),
    commands: { terminalAck: "terminal.ack", terminalInput: "terminal.input", terminalResize: "terminal.resize" },
  },
  valueOf: (result: unknown) =>
    Option.getOrUndefined(AsyncResult.value(result as AsyncResult.AsyncResult<unknown, unknown>)),
  failureMessage: (_cause: unknown, fallback: string) => fallback,
}))

const deliver = (feed: { seq: number; items: readonly { seq: number; event: unknown }[] }) =>
  state.handler?.(AsyncResult.success(feed))

const fail = (message: string) => state.handler?.(AsyncResult.failure(Cause.fail(new Error(message))))

function hooks() {
  const events: unknown[] = []
  const statuses: { status: string; message?: string }[] = []
  return {
    events,
    statuses,
    onEvent: (event: unknown) => events.push(event),
    onStatus: (status: string, message?: string) => statuses.push({ status, message }),
  }
}

describe("terminal session", () => {
  it("delivers the snapshot then live output, and acknowledges the bytes once", async () => {
    state.calls = []
    const seen = hooks()
    startTerminal("pc-1", "t-1", seen)

    deliver({
      seq: 2,
      items: [
        {
          seq: 1,
          event: { type: "snapshot", history: "ready\r\n", cols: 80, rows: 24, status: "running", exitCode: null },
        },
        { seq: 2, event: { type: "output", data: "$ " } },
      ],
    })

    expect(seen.events).toEqual([
      { type: "snapshot", history: "ready\r\n", cols: 80, rows: 24, status: "running", exitCode: null },
      { type: "output", data: "$ " },
    ])
    expect(seen.statuses.at(-1)?.status).toBe("live")
    expect(state.calls).toEqual([{ command: "terminal.ack", input: { pcId: "pc-1", terminalId: "t-1", bytes: 9 } }])
  })

  it("skips events it has already delivered", () => {
    const seen = hooks()
    startTerminal("pc-1", "t-1", seen)

    deliver({ seq: 1, items: [{ seq: 1, event: { type: "output", data: "one" } }] })
    deliver({ seq: 1, items: [{ seq: 1, event: { type: "output", data: "one" } }] })

    expect(seen.events).toHaveLength(1)
  })

  it("says why the terminal could not be opened", () => {
    const seen = hooks()
    startTerminal("pc-1", "t-1", seen)

    fail("box is offline")

    expect(seen.statuses).toEqual([{ status: "error", message: "Kiko could not open this terminal." }])
  })

  it("reports an exit and stops sending after close", () => {
    const seen = hooks()
    const session = startTerminal("pc-1", "t-1", seen)

    deliver({ seq: 1, items: [{ seq: 1, event: { type: "exit", code: 0 } }] })
    expect(seen.statuses.at(-1)?.status).toBe("ended")

    session.close()
    session.input("x")

    expect(state.stop).toBeGreaterThan(0)
    expect(state.calls.some((call) => call.command === "terminal.input")).toBe(false)
  })

  it("sends input and resize to the worker", () => {
    state.calls = []
    const session = startTerminal("pc-1", "t-1", hooks())

    session.input("ls\r")
    session.resize(100, 30)

    expect(state.calls).toEqual([
      { command: "terminal.input", input: { pcId: "pc-1", terminalId: "t-1", data: "ls\r" } },
      { command: "terminal.resize", input: { pcId: "pc-1", terminalId: "t-1", cols: 100, rows: 30 } },
    ])
  })
})
