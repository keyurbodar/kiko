import type { Sender } from "@kiko/protocol"

// Architecture section 6.2. What the agent does with an arrival while it works. `decide` is a pure
// table. The host reads the run's state, asks it, and makes the `pi-durable` call it names.

/** A burst may restart a run at most this many times. The next arrival steers or queues. */
export const MAX_RESTARTS = 2

export type MidRunAction =
  /** Abort the run, then submit. The model sees both user turns and answers once. */
  | "restart"
  /** `submit({ whenBusy: "steer" })`: the input joins the run after the current tool round. */
  | "steer"
  /** `submit()`: a follow-up that starts the next run. On an idle conversation it starts a run at once. */
  | "queue"
  /** `conversation.abort()`. Nothing is submitted. */
  | "abort"

/** The current run, or null when the conversation is idle. */
export type RunState = {
  /** The run has sent a bubble to the room, so the human may have read it. */
  bubblePosted: boolean
  /** A tool round started in this run, running or finished. */
  toolStarted: boolean
  /** A tool is running now. */
  toolRunning: boolean
  /** Inputs wait in the conversation's queue. An abort would withdraw them. */
  queued: boolean
  /** How often the current burst has already restarted a run. */
  restarts: number
}

export type Arrival = { kind: Sender["kind"] } | { kind: "stop" }

/** The run state before the agent has seen anything of the run. */
export const FRESH_RUN: Omit<RunState, "restarts" | "queued"> = { bubblePosted: false, toolStarted: false, toolRunning: false }

/**
 * Rows in order; the first that matches wins.
 *
 * | arrival | run                                   | action  |
 * | ------- | ------------------------------------- | ------- |
 * | stop    | any                                   | abort   |
 * | any     | idle                                  | queue   |
 * | agent   | busy                                  | queue   |
 * | human   | a tool is running                     | steer   |
 * | human   | a bubble was posted                   | queue   |
 * | human   | a tool round started and finished     | steer   |
 * | human   | inputs are queued                     | steer   |
 * | human   | restarted MAX_RESTARTS times already  | steer   |
 * | human   | nothing visible, nothing started      | restart |
 */
export function decide(run: RunState | null, arrival: Arrival): MidRunAction {
  if (arrival.kind === "stop") return "abort"
  if (!run) return "queue"
  // ASSUMPTION: only a human interrupts. An agent or system message waits for the run to answer (section 7.8).
  if (arrival.kind !== "human") return "queue"
  if (run.toolRunning) return "steer"
  if (run.bubblePosted) return "queue"
  // Never restart after a tool: a rerun would repeat its side effect, and an abort would lose its result.
  if (run.toolStarted) return "steer"
  // An abort withdraws queued inputs, so a restart would lose them.
  if (run.queued) return "steer"
  // The cap. Steering keeps one answer; with no tool round it is placed when the run answers.
  if (run.restarts >= MAX_RESTARTS) return "steer"
  return "restart"
}
