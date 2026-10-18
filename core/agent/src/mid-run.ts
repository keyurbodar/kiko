import type { Sender } from "./envelope"

export const MAX_RESTARTS = 2

export type MidRunAction =
  | "restart"
  | "steer"
  | "interrupt"
  | "queue"
  | "hold"

export type RunState = {
  bubblePosted: boolean
  toolStarted: boolean
  // The tool calls still running, by call id, with the tool's name.
  tools: ReadonlyMap<string, string>
  queued: boolean
  restarts: number
}

export type RunProgress = Pick<RunState, "bubblePosted" | "toolStarted" | "tools">

export type Arrival = { kind: Sender["kind"] }

export const FRESH_RUN: Omit<RunState, "restarts" | "queued"> = { bubblePosted: false, toolStarted: false, tools: new Map() }

export function decide(run: RunState | null, arrival: Arrival): MidRunAction {
  if (!run) return "queue"
  if (arrival.kind !== "human") return "hold"
  // A human never waits for a run to end. A running tool may be stopped; the steer lands right after it.
  if (run.tools.size > 0) return "interrupt"
  if (run.bubblePosted || run.toolStarted || run.queued || run.restarts >= MAX_RESTARTS) return "steer"
  return "restart"
}
