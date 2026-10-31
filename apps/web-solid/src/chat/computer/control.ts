type InputGate<T> = {
  send(items: readonly T[]): void
  hold(): void
  release(): void
  discard(): void
}

export function createInputGate<T>(deliver: (items: readonly T[]) => void): InputGate<T> {
  let held = false
  let pending: T[] = []
  return {
    send(items) {
      if (held) {
        pending.push(...items)
        return
      }
      deliver(items)
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
