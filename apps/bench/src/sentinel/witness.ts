import type { Background } from "../types"

export type Front = "self" | "other"

export type WitnessEvent =
  | { readonly ev: "ready"; readonly t: number }
  | { readonly ev: "exit"; readonly t: number }
  | { readonly ev: "error"; readonly t: number; readonly message: string }
  | { readonly ev: "tick"; readonly t: number; readonly received: boolean }
  | {
      readonly ev: "sample"
      readonly t: number
      readonly front: Front
      readonly key: boolean
      readonly above: readonly string[]
      readonly pointer: readonly [number, number]
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

function readEvent(value: unknown): WitnessEvent | undefined {
  if (!isRecord(value) || typeof value.ev !== "string" || typeof value.t !== "number") return undefined
  switch (value.ev) {
    case "ready":
      return { ev: "ready", t: value.t }
    case "exit":
      return { ev: "exit", t: value.t }
    case "error":
      return typeof value.message === "string" ? { ev: "error", t: value.t, message: value.message } : undefined
    case "tick":
      return typeof value.received === "boolean" ? { ev: "tick", t: value.t, received: value.received } : undefined
    case "sample":
      return isFront(value.front) && typeof value.key === "boolean" && isNames(value.above) && isPoint(value.pointer)
        ? {
            ev: "sample",
            t: value.t,
            front: value.front,
            key: value.key,
            above: value.above,
            pointer: value.pointer,
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
  error: string | undefined
  keysSent: number
  keysReceived: number
  samples: number
  steals: number
  pointerMoves: number
  raised: number
}

function tally(events: readonly WitnessEvent[]): Tally {
  const state: Tally = {
    ready: false,
    error: undefined,
    keysSent: 0,
    keysReceived: 0,
    samples: 0,
    steals: 0,
    pointerMoves: 0,
    raised: 0,
  }
  let focused = true
  let moved = false
  let baseline: readonly [number, number] | undefined
  let above: ReadonlySet<string> = new Set()
  for (const event of events) {
    switch (event.ev) {
      case "ready":
        state.ready = true
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
      case "sample": {
        state.samples += 1
        baseline ??= event.pointer
        const [x, y] = event.pointer
        const [baseX, baseY] = baseline
        const far = Math.hypot(x - baseX, y - baseY) > POINTER_TOLERANCE_PX
        if (far && !moved) state.pointerMoves += 1
        moved = far
        const nowFocused = event.front === "self" && event.key
        if (!nowFocused && focused) state.steals += 1
        focused = nowFocused
        const current = new Set(event.above)
        for (const name of current) {
          if (!above.has(name)) state.raised += 1
        }
        above = current
        break
      }
      default: {
        const exhaustive: never = event
        throw new Error(`unhandled sentinel event ${JSON.stringify(exhaustive)}`)
      }
    }
  }
  return state
}

export function witness(events: readonly WitnessEvent[]): Witness {
  const state = tally(events)
  return {
    background: {
      focusSteals: state.steals,
      pointerMoves: state.pointerMoves,
      keysSwallowed: state.keysSent - state.keysReceived,
      windowsRaised: state.raised,
    },
    keysSent: state.keysSent,
    keysReceived: state.keysReceived,
    samples: state.samples,
    ready: state.ready,
    error: state.error,
  }
}
