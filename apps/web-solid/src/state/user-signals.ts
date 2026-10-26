import type { UserSignal } from "@kiko/protocol"

type SignalOf<T extends UserSignal["t"]> = Extract<UserSignal, { t: T }>
type Listener = (signal: UserSignal) => void

const STATE_SIGNALS: ReadonlySet<UserSignal["t"]> = new Set(["pcState", "browserState"])

export function createUserSignals() {
  const listeners = new Map<UserSignal["t"], Set<Listener>>()
  const latest = new Map<UserSignal["t"], UserSignal>()

  function on<T extends UserSignal["t"]>(t: T, listener: (signal: SignalOf<T>) => void): () => void {
    const set = listeners.get(t) ?? new Set()
    listeners.set(t, set)
    set.add(listener as Listener)
    const current = latest.get(t)
    if (current) listener(current as SignalOf<T>)
    return () => set.delete(listener as Listener)
  }

  function deliver(signal: UserSignal): void {
    if (STATE_SIGNALS.has(signal.t)) latest.set(signal.t, signal)
    for (const listener of listeners.get(signal.t) ?? []) listener(signal)
  }

  return { on, deliver }
}
