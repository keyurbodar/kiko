import type { ComputerInput } from "@kiko/protocol"

type InputGate = {
  send(events: readonly ComputerInput[]): void
  hold(): void
  release(): void
  discard(): void
}

export function createInputGate(deliver: (events: readonly ComputerInput[]) => void): InputGate {
  let held = false
  let pending: ComputerInput[] = []
  return {
    send(events) {
      if (held) {
        pending.push(...events)
        return
      }
      deliver(events)
    },
    hold() {
      held = true
    },
    release() {
      held = false
      const flush = pending
      pending = []
      if (flush.length > 0) deliver(flush)
    },
    discard() {
      held = false
      pending = []
    },
  }
}
