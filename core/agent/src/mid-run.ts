import type { Sender } from "./envelope"

const MAX_RESTARTS = 2

type MidRunAction =
  | "restart"
  | "steer"
  | "interrupt"
  | "queue"
  | "hold"

export type RunState = {
  bubblePosted: boolean
  toolStarted: boolean
  tools: ReadonlyMap<string, string>
  queued: boolean
  restarts: number
}

export type RunProgress = Pick<RunState, "bubblePosted" | "toolStarted" | "tools">

type Arrival = { kind: Sender["kind"] }

export const FRESH_RUN: Omit<RunState, "restarts" | "queued"> = { bubblePosted: false, toolStarted: false, tools: new Map() }

export function decide(run: RunState | null, arrival: Arrival): MidRunAction {
  if (!run) return "queue"
  if (arrival.kind !== "human") return "hold"
  if (run.tools.size > 0) return "interrupt"
  if (run.bubblePosted || run.toolStarted || run.queued || run.restarts >= MAX_RESTARTS) return "steer"
  return "restart"
}
