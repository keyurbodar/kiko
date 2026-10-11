import type { Sender } from "./envelope"

export const MAX_RESTARTS = 2

export type MidRunAction =
  | "restart"
  | "steer"
  | "queue"
  | "hold"

export type RunState = {
  bubblePosted: boolean
  toolStarted: boolean
  toolRunning: boolean
  queued: boolean
  restarts: number
}

export type RunProgress = Pick<RunState, "bubblePosted" | "toolStarted" | "toolRunning">

export type Arrival = { kind: Sender["kind"] }

export const FRESH_RUN: Omit<RunState, "restarts" | "queued"> = { bubblePosted: false, toolStarted: false, toolRunning: false }

export function decide(run: RunState | null, arrival: Arrival): MidRunAction {
  if (!run) return "queue"
  if (arrival.kind !== "human") return "hold"
  // A human never waits for a run to end (section 6.2). pi-durable places a steer after the tool round, or when the run answers.
  if (run.toolRunning || run.bubblePosted || run.toolStarted || run.queued || run.restarts >= MAX_RESTARTS) return "steer"
  return "restart"
}
