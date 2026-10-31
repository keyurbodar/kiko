import type { FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import { failureMessage } from "../log"
import type { TerminalManager, TerminalView } from "./manager"

type Open = Extract<ToDaemon, { t: "terminal" }>
type Input = Extract<ToDaemon, { t: "terminalInput" }>
type Resize = Extract<ToDaemon, { t: "terminalResize" }>
type Ack = Extract<ToDaemon, { t: "terminalAck" }>

export type TerminalLink = {
  open(frame: Open): void
  input(frame: Input): void
  resize(frame: Resize): void
  ack(frame: Ack): void
  close(): void
}

export function createTerminalLink(deps: {
  manager(): TerminalManager | null
  holder(): Holder
  send(frame: FromDaemon): void
}): TerminalLink {
  const views = new Map<string, TerminalView>()

  const drop = (id: string) => {
    views.get(id)?.detach()
    views.delete(id)
  }

  return {
    open(frame) {
      drop(frame.id)
      if (!frame.on) return
      const event = (next: Extract<FromDaemon, { t: "terminal" }>["event"]) =>
        deps.send({ t: "terminal", id: frame.id, event: next })
      const manager = deps.manager()
      if (!manager) {
        event({ type: "error", message: "this machine cannot open terminal sessions" })
        return
      }
      try {
        views.set(frame.id, manager.attach({ id: frame.terminal ?? "", cols: frame.cols, rows: frame.rows }, event))
      } catch (error) {
        event({ type: "error", message: failureMessage(error) })
      }
    },
    input(frame) {
      if (deps.holder() !== "human") return
      views.get(frame.id)?.write(frame.data)
    },
    resize(frame) {
      views.get(frame.id)?.resize(frame.cols, frame.rows)
    },
    ack(frame) {
      views.get(frame.id)?.ack(frame.bytes)
    },
    close() {
      for (const id of [...views.keys()]) drop(id)
    },
  }
}
