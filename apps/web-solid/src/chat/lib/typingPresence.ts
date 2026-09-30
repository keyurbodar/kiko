import { createSignal, onCleanup, type Accessor, type Signal } from "solid-js"

export interface TypingPresenceOptions {
  /** A name drops off the roster this long after its last ping. */
  timeout: number
  /** How long a name stays up once it has appeared, however briefly it pinged. */
  minVisible: number
  /** How long the bubble holds after a name leaves, so it does not flicker. */
  sendMs: number
}

export interface TypingPresence {
  /** Names currently typing, in the order they first appeared. */
  typists: Accessor<readonly string[]>
  /** The wave the three dots ride: read the phase, write it from the animation. */
  beat: Signal<number>
  /** True while the bubble is holding after the last name left. */
  sending: Accessor<boolean>
  /** A name is typing. Refreshes its idle deadline. */
  ping: (name: string) => void
  /** The viewer hit send: hold the bubble for `sendMs`. */
  send: () => void
  /** Drop the roster, leaving a send already in flight to finish collapsing. */
  clear: () => void
  /** `clear()`, plus the sending hold: the store is pristine again. */
  reset: () => void
}

interface Typist {
  name: string
  shownAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * The reference indicator's roster, lifted out of React state into Solid
 * signals. A name stays up for at least `minVisible` even if it pinged once and
 * vanished, and the bubble keeps its place for `sendMs` after the last name
 * goes, so a short burst never flashes the row in and out.
 *
 * The roster is republished on every event rather than derived in a memo: it
 * only ever changes when somebody pings, leaves, or the thread is cleared.
 */
export function createTypingPresence(options: TypingPresenceOptions): TypingPresence {
  const roster = new Map<string, Typist>()
  const [names, setNames] = createSignal<readonly string[]>([])
  const beat = createSignal(0)
  const [sending, setSending] = createSignal(false)
  let sendTimer: ReturnType<typeof setTimeout> | undefined

  // Map iteration is insertion order and re-pinging keeps a key where it is, so
  // the roster is already ordered by who showed up first.
  const publish = () => setNames([...roster.values()].map((typist) => typist.name))

  const holdSending = () => {
    setSending(true)
    if (sendTimer !== undefined) clearTimeout(sendTimer)
    sendTimer = setTimeout(() => {
      sendTimer = undefined
      setSending(false)
    }, options.sendMs)
  }

  const leave = (typist: Typist) => {
    if (!roster.delete(typist.name)) return
    publish()
    holdSending()
  }

  /** The idle deadline passed; hold the name up until the minimum window ends. */
  const settleMinimum = (typist: Typist) => {
    const remaining = typist.shownAt + options.minVisible - Date.now()
    if (remaining <= 0) {
      leave(typist)
      return
    }
    typist.timer = setTimeout(() => leave(typist), remaining)
  }

  const clearRoster = () => {
    for (const typist of roster.values()) {
      if (typist.timer !== undefined) clearTimeout(typist.timer)
    }
    roster.clear()
    publish()
  }

  const dropAll = () => {
    clearRoster()
    if (sendTimer !== undefined) {
      clearTimeout(sendTimer)
      sendTimer = undefined
    }
    setSending(false)
  }

  onCleanup(dropAll)

  return {
    typists: names,
    beat,
    sending,
    ping: (name) => {
      let typist = roster.get(name)
      if (typist) {
        if (typist.timer !== undefined) {
          clearTimeout(typist.timer)
          typist.timer = undefined
        }
      } else {
        typist = { name, shownAt: Date.now(), timer: undefined }
        roster.set(name, typist)
        publish()
      }
      const entry = typist
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        settleMinimum(entry)
      }, options.timeout)
    },
    send: holdSending,
    clear: clearRoster,
    reset: dropAll,
  }
}
