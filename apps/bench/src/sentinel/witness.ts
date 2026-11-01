import type { Background, BackgroundCounter } from "../types"

export type Front = "self" | "other"

export type WitnessEvent =
  | { readonly ev: "ready"; readonly t: number; readonly unmeasured?: readonly BackgroundCounter[] }
  | { readonly ev: "exit"; readonly t: number }
  | { readonly ev: "error"; readonly t: number; readonly message: string }
  | { readonly ev: "tick"; readonly t: number; readonly received: boolean; readonly n?: number }
  | {
      readonly ev: "sample"
      readonly t: number
      readonly front: Front
      readonly key: boolean
      readonly above: readonly string[]
      readonly pointer?: readonly [number, number]
    }

export interface Witness {
  readonly background: Background
  readonly keysSent: number
  readonly keysReceived: number
  readonly samples: number
  readonly ready: boolean
  readonly error: string | undefined
}

const POINTER_TOLERANCE_PX = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFront(value: unknown): value is Front {
  return value === "self" || value === "other"
}

function isPoint(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number"
}

function isNames(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((name) => typeof name === "string")
}

const COUNTERS: ReadonlySet<string> = new Set(["focusSteals", "pointerMoves", "keysSwallowed", "windowsRaised"])

function isCounters(value: unknown): value is readonly BackgroundCounter[] {
  return Array.isArray(value) && value.every((name) => typeof name === "string" && COUNTERS.has(name))
}

function readEvent(value: unknown): WitnessEvent | undefined {
  if (!isRecord(value) || typeof value.ev !== "string" || typeof value.t !== "number") return undefined
  switch (value.ev) {
    case "ready":
      return value.unmeasured === undefined
        ? { ev: "ready", t: value.t }
        : isCounters(value.unmeasured)
          ? { ev: "ready", t: value.t, unmeasured: value.unmeasured as BackgroundCounter[] }
          : undefined
    case "exit":
      return { ev: "exit", t: value.t }
    case "error":
      return typeof value.message === "string" ? { ev: "error", t: value.t, message: value.message } : undefined
    case "tick":
      return typeof value.received === "boolean"
        ? { ev: "tick", t: value.t, received: value.received, ...(typeof value.n === "number" ? { n: value.n } : {}) }
        : undefined
    case "sample":
      return isFront(value.front) &&
        typeof value.key === "boolean" &&
        isNames(value.above) &&
        (value.pointer === undefined || isPoint(value.pointer))
        ? {
            ev: "sample",
            t: value.t,
            front: value.front,
            key: value.key,
            above: value.above,
            ...(value.pointer === undefined ? {} : { pointer: value.pointer as readonly [number, number] }),
          }
        : undefined
    default:
      return undefined
  }
}

export function parseEvents(text: string): WitnessEvent[] {
  const events: WitnessEvent[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const event = readEvent(parsed)
    if (event) events.push(event)
  }
  return events
}

interface Tally {
  ready: boolean
  unmeasured: Set<BackgroundCounter>
  error: string | undefined
  keysSent: number
  keysReceived: number
  samples: number
  steals: number
  pointerMoves: number
  raised: number
}

interface Seen {
  focused: boolean
  moved: boolean
  baseline: readonly [number, number] | undefined
  above: ReadonlySet<string> | undefined
}

function countSample(state: Tally, seen: Seen, event: Extract<WitnessEvent, { ev: "sample" }>) {
  state.samples += 1
  if (event.pointer) {
    seen.baseline ??= event.pointer
    const [x, y] = event.pointer
    const [baseX, baseY] = seen.baseline
    const far = Math.hypot(x - baseX, y - baseY) > POINTER_TOLERANCE_PX
    if (far && !seen.moved) state.pointerMoves += 1
    seen.moved = far
  }
  const nowFocused = event.front === "self" && event.key
  if (!nowFocused && seen.focused) state.steals += 1
  seen.focused = nowFocused
  const current = new Set(event.above)
  if (seen.above !== undefined) {
    for (const name of current) {
      if (!seen.above.has(name)) state.raised += 1
    }
  }
  seen.above = current
}

function tally(events: readonly WitnessEvent[]): Tally {
  const state: Tally = {
    ready: false,
    unmeasured: new Set(),
    error: undefined,
    keysSent: 0,
    keysReceived: 0,
    samples: 0,
    steals: 0,
    pointerMoves: 0,
    raised: 0,
  }
  const seen: Seen = { focused: true, moved: false, baseline: undefined, above: undefined }
  for (const event of events) {
    switch (event.ev) {
      case "ready":
        state.ready = true
        for (const counter of event.unmeasured ?? []) state.unmeasured.add(counter)
        break
      case "exit":
        break
      case "error":
        state.error = event.message
        break
      case "tick":
        state.keysSent += 1
        if (event.received) state.keysReceived += 1
        break
      case "sample":
        countSample(state, seen, event)
        break
      default: {
        const exhaustive: never = event
        throw new Error(`unhandled sentinel event ${JSON.stringify(exhaustive)}`)
      }
    }
  }
  return state
}

export function missingKeys(events: readonly WitnessEvent[]): number[] {
  const missing: number[] = []
  let index = 0
  for (const event of events) {
    if (event.ev !== "tick") continue
    if (!event.received) missing.push(event.n ?? index)
    index += 1
  }
  return missing
}

export function witness(events: readonly WitnessEvent[]): Witness {
  const state = tally(events)
  return {
    background: {
      focusSteals: state.steals,
      pointerMoves: state.pointerMoves,
      keysSwallowed: state.keysSent - state.keysReceived,
      windowsRaised: state.raised,
      ...(state.unmeasured.size === 0 ? {} : { unmeasured: [...state.unmeasured] }),
    },
    keysSent: state.keysSent,
    keysReceived: state.keysReceived,
    samples: state.samples,
    ready: state.ready,
    error: state.error,
  }
}
