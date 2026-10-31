import { setTerminalSize, terminalKey, type TerminalFeed } from "@kiko/client-runtime/state"
import type { TerminalEvent } from "@kiko/protocol"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { failureMessage, observe, owner, run, valueOf } from "../../state/runtime"

export type TerminalStatus = "connecting" | "live" | "ended" | "error"

export type TerminalHooks = {
  onEvent(event: TerminalEvent): void
  onStatus(status: TerminalStatus, message?: string): void
}

export type TerminalSession = {
  input(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export function startTerminal(pcId: string, terminalId: string, hooks: TerminalHooks): TerminalSession {
  const key = terminalKey(pcId, terminalId)
  let seen = 0
  let closed = false

  const read = (feed: TerminalFeed) => {
    let bytes = 0
    for (const item of feed.items) {
      if (item.seq <= seen) continue
      seen = item.seq
      const event = item.event
      if (event.type === "output") bytes += event.data.length
      if (event.type === "snapshot") bytes += event.history.length
      if (event.type === "error") hooks.onStatus("error", event.message)
      else if (event.type === "exit") hooks.onStatus("ended")
      else hooks.onStatus("live")
      hooks.onEvent(event)
    }
    if (bytes > 0) void run(owner.commands.terminalAck, { pcId, terminalId, bytes })
  }

  const drain = (result: AsyncResult.AsyncResult<TerminalFeed, unknown>) => {
    if (closed) return
    if (AsyncResult.isFailure(result)) {
      hooks.onStatus("error", failureMessage(result.cause, "Kiko could not open this terminal."))
      return
    }
    const feed = valueOf(result)
    if (feed) read(feed)
  }

  const stop = observe(owner.terminalAtom(key), drain, { immediate: true })

  return {
    input(data) {
      if (closed || !data) return
      void run(owner.commands.terminalInput, { pcId, terminalId, data })
    },
    resize(cols, rows) {
      if (closed) return
      setTerminalSize(key, cols, rows)
      void run(owner.commands.terminalResize, { pcId, terminalId, cols, rows })
    },
    close() {
      closed = true
      stop()
    },
  }
}
