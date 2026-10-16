/*
 * The first-run steps as data. `stepFor` is the one rule for what a person sees: it reads facts
 * (signed in or not, what this browser saved, what the server says is connected) and answers a
 * step, or "done" when first run has nothing to show. `advance` moves one step on a button.
 */
export type Step = "welcome" | "connect" | "model" | "done"
export type Move = "next" | "skip"

/** The steps the progress bar counts, in order. */
export const SHOWN: readonly Exclude<Step, "done">[] = ["welcome", "connect", "model"]

export interface Facts {
  signedIn: boolean
  /** A hosted build signs in on its own screen, so welcome is never ours there. */
  hosted: boolean
  /** The step this browser saved for this person. */
  saved: Step | null
  /** The person just entered the access code in this page. */
  fresh: boolean
  /** The server has answered whether any model provider is connected. */
  known: boolean
  connected: boolean
}

export function stepFor(f: Facts): Step {
  if (!f.signedIn) return f.hosted ? "done" : "welcome"
  if (f.saved === "done") return "done"
  if (f.saved === "connect") return f.connected ? "model" : "connect"
  if (f.saved === "model") return "model"
  if (f.known) return f.connected ? "done" : "connect"
  return f.fresh ? "connect" : "done"
}

const NEXT: Record<Step, Record<Move, Step>> = {
  welcome: { next: "connect", skip: "connect" },
  connect: { next: "model", skip: "done" },
  model: { next: "done", skip: "done" },
  done: { next: "done", skip: "done" },
}

export const advance = (step: Step, move: Move): Step => NEXT[step][move]

/** Position of a step in the bar, from 1. */
export const positionOf = (step: Step): number => SHOWN.indexOf(step as (typeof SHOWN)[number]) + 1
