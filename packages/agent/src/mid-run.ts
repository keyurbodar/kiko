import type { Sender } from "./envelope"

export const MAX_RESTARTS = 2

export type MidRunAction =
  | "restart"
  | "steer"
  | "queue"
  | "abort"
  | "hold"

export type RunState = {
  bubblePosted: boolean
  toolStarted: boolean
  toolRunning: boolean
  queued: boolean
  restarts: number
}

export type RunProgress = Pick<RunState, "bubblePosted" | "toolStarted" | "toolRunning">

export type Arrival = { kind: Sender["kind"] } | { kind: "stop" }

export const FRESH_RUN: Omit<RunState, "restarts" | "queued"> = { bubblePosted: false, toolStarted: false, toolRunning: false }

export function decide(run: RunState | null, arrival: Arrival): MidRunAction {
  if (arrival.kind === "stop") return "abort"
  if (!run) return "queue"
  if (arrival.kind !== "human") return "hold"
  if (run.toolRunning) return "steer"
  if (run.bubblePosted) return "queue"
  if (run.toolStarted) return "steer"
  if (run.queued) return "steer"
  if (run.restarts >= MAX_RESTARTS) return "steer"
  return "restart"
}
