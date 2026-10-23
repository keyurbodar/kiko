import { type Accessor, createSignal, getOwner, onCleanup } from "solid-js"

export const SEND_MS = 340
const SWEEP_FLOOR_MS = 24

export interface Clock {
  now: () => number
  after: (fn: () => void, ms: number) => () => void
}

const realClock: Clock = {
  now: () => Date.now(),
  after: (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

export interface TypingPresenceOptions {
  timeout?: number
  minVisible?: number
  clock?: Clock
}

export interface TypingPresence {
  typists: Accessor<string[]>
  beat: Accessor<number>
  sending: Accessor<boolean>
  ping: (name: string) => void
  send: (name: string) => void
  clear: (name: string) => void
  reset: () => void
}

export function createTypingPresence({
  timeout = 3000,
  minVisible = 900,
  clock = realClock,
}: TypingPresenceOptions = {}): TypingPresence {
  const [presence, setPresence] = createSignal<{ typists: string[]; beat: number }>({ typists: [], beat: 0 })
  const [sending, setSending] = createSignal(false)

  const seen = new Map<string, number>()
  let shown: string[] = []
  let shownAt = 0
  let cancelSweep: (() => void) | null = null
  let cancelRelease: (() => void) | null = null

  const stopSweep = () => {
    cancelSweep?.()
    cancelSweep = null
  }

  const commit = (bump: boolean) => {
    const now = clock.now()

    for (const [name, at] of seen) {
      if (at + timeout <= now) seen.delete(name)
    }

    let next = Infinity
    for (const at of seen.values()) next = Math.min(next, at + timeout)

    let roster = Array.from(seen.keys())
    if (roster.length === 0 && shown.length > 0) {
      const until = shownAt + minVisible
      if (until > now) {
        roster = shown
        next = Math.min(next, until)
      }
    }

    const changed = roster.length !== shown.length || roster.some((name, i) => name !== shown[i])

    if (changed) {
      if (shown.length === 0) shownAt = now
      shown = roster
    }

    if (changed || bump) {
      setPresence((prev) => ({
        typists: changed ? roster : prev.typists,
        beat: changed && roster.length === 0 ? 0 : bump ? prev.beat + 1 : prev.beat,
      }))
    }

    stopSweep()
    if (next !== Infinity) {
      cancelSweep = clock.after(() => commit(false), Math.max(SWEEP_FLOOR_MS, next - now))
    }
  }

  const ping = (name: string) => {
    if (cancelRelease) {
      cancelRelease()
      cancelRelease = null
      setSending(false)
      shown = []
      shownAt = 0
    }
    seen.set(name, clock.now())
    commit(true)
  }

  const clear = (name: string) => {
    if (!seen.delete(name)) return
    commit(false)
  }

  const send = (name: string) => {
    if (!seen.has(name) && !shown.includes(name)) return
    seen.delete(name)
    stopSweep()
    setSending(true)

    cancelRelease?.()
    cancelRelease = clock.after(() => {
      cancelRelease = null
      setSending(false)
      shown = []
      shownAt = 0
      setPresence({ typists: [], beat: 0 })
      if (seen.size > 0) commit(false)
    }, SEND_MS)
  }

  const teardown = () => {
    stopSweep()
    cancelRelease?.()
    cancelRelease = null
  }

  const reset = () => {
    teardown()
    seen.clear()
    shown = []
    shownAt = 0
    setSending(false)
    setPresence({ typists: [], beat: 0 })
  }

  if (getOwner()) onCleanup(teardown)

  return {
    typists: () => presence().typists,
    beat: () => presence().beat,
    sending,
    ping,
    send,
    clear,
    reset,
  }
}

export function describe(names: string[], max: number): string {
  if (names.length === 0) return ""

  const head = names.slice(0, Math.max(1, max))
  const rest = names.length - head.length

  if (rest > 0) {
    return `${head.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"} are typing`
  }
  if (head.length === 1) return `${head[0]} is typing`

  return `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]} are typing`
}
