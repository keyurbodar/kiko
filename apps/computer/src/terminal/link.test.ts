import { describe, expect, it } from "@effect/vitest"
import type { FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import { createTerminalLink } from "./link"
import { TerminalManager } from "./manager"
import type { Pty, PtyInput } from "./pty"
import type { Screen } from "./screen"

type Frame = Extract<FromDaemon, { t: "terminal" }>

function harness() {
  let input: PtyInput | null = null
  const writes: string[] = []
  const resizes: [number, number][] = []
  const pty: Pty = {
    pid: 1,
    write: (data) => writes.push(data),
    resize: (cols, rows) => resizes.push([cols, rows]),
    kill: () => {},
    close: () => {},
    exited: Promise.resolve(0),
  }
  const screen: Screen = { write: (_text, done) => done?.(), text: () => "", resize: () => {}, dispose: () => {} }
  const manager = new TerminalManager({
    spawn: (next) => {
      input = next
      return pty
    },
    screen: () => screen,
  })
  const sent: Frame[] = []
  let holder: Holder = "human"
  const link = createTerminalLink({
    manager: () => manager,
    holder: () => holder,
    send: (frame) => sent.push(frame as Frame),
  })
  const terminal = manager.open({})
  const emit = (text: string) => input?.onData(new TextEncoder().encode(text))
  return {
    link,
    terminal,
    sent,
    writes,
    resizes,
    emit,
    setHolder: (next: Holder) => {
      holder = next
    },
  }
}

describe("terminal link", () => {
  it("sends the snapshot under the attach id", () => {
    const { link, terminal, sent, emit } = harness()
    emit("ready\r\n")

    link.open({ t: "terminal", on: true, id: "a1", terminal: terminal.id })

    expect(sent[0]).toMatchObject({ t: "terminal", id: "a1", event: { type: "snapshot", history: "ready\r\n" } })
  })

  it("reports a terminal that is gone instead of throwing", () => {
    const { link, sent } = harness()

    link.open({ t: "terminal", on: true, id: "a1", terminal: "missing" })

    expect(sent[0]).toMatchObject({ t: "terminal", id: "a1", event: { type: "error" } })
  })

  it("writes owner input only while the owner holds control", () => {
    const { link, terminal, writes, setHolder } = harness()
    link.open({ t: "terminal", on: true, id: "a1", terminal: terminal.id })

    link.input({ t: "terminalInput", id: "a1", data: "ls\r" })
    setHolder("agent")
    link.input({ t: "terminalInput", id: "a1", data: "rm -rf /\r" })

    expect(writes).toEqual(["ls\r"])
  })

  it("resizes the attached terminal and forgets it on detach", () => {
    const { link, terminal, sent, writes, resizes } = harness()
    link.open({ t: "terminal", on: true, id: "a1", terminal: terminal.id, cols: 100, rows: 30 })

    link.resize({ t: "terminalResize", id: "a1", cols: 80, rows: 24 })
    link.open({ t: "terminal", on: false, id: "a1" })
    link.input({ t: "terminalInput", id: "a1", data: "x" })

    expect(resizes).toEqual([
      [100, 30],
      [80, 24],
    ])
    expect(writes).toEqual([])
    expect(sent.map((frame) => frame.event.type)).toEqual(["snapshot"])
  })

  it("forgets every attach when it closes", () => {
    const { link, terminal, writes } = harness()
    link.open({ t: "terminal", on: true, id: "a1", terminal: terminal.id })

    link.close()
    link.input({ t: "terminalInput", id: "a1", data: "x" })

    expect(writes).toEqual([])
  })
})
