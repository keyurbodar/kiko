/*
 * The first-run steps as data. `stepFor` is the one rule for what a person sees: it reads facts
 * (signed in or not, what this browser saved, what the server says is connected) and answers a
 * step, or "done" when first run has nothing to show. `advance` moves one step on a button.
 * "connect" is the model provider key; "cloudflare" installs a hosted person's backend.
 */
export type Step = "welcome" | "sign-in" | "cloudflare" | "connect" | "model" | "done"
export type Move = "next" | "skip"

/** The steps the stepper counts, in order, with their labels. Welcome is the cover, not a step. */
export const stepsFor = (hosted: boolean): readonly { step: Step; label: string }[] => [
  { step: "sign-in", label: "Sign in" },
  ...(hosted ? [{ step: "cloudflare" as const, label: "Cloudflare" }] : []),
  { step: "connect", label: "Provider" },
  { step: "model", label: "Model" },
]

export interface Facts {
  signedIn: boolean
  hosted: boolean
  /** The person pressed "Get started", or this browser has signed in before. */
  started: boolean
  /** Hosted only: Clerk knows the person, but they have no backend yet. */
  needsBackend: boolean
  /** The step this browser saved for this person. */
  saved: Step | null
  /** The person just signed in on this page, so the next step shows without waiting on the network. */
  fresh: boolean
  /** The server has answered whether any model provider is connected. */
  known: boolean
  connected: boolean
  /** The server says first run was finished or skipped, on this device or another. */
  onboarded: boolean
}

export function stepFor(f: Facts): Step {
  if (!f.signedIn) {
    if (f.hosted && f.needsBackend) return "cloudflare"
    return f.started ? "sign-in" : "welcome"
  }
  if (f.saved === "done") return "done"
  if (f.saved === "connect") return f.connected ? "model" : "connect"
  if (f.saved === "model") return "model"
  if (f.known) return f.connected || f.onboarded ? "done" : "connect"
  return f.fresh ? "connect" : "done"
}

const NEXT: Partial<Record<Step, Record<Move, Step>>> = {
  connect: { next: "model", skip: "done" },
  model: { next: "done", skip: "done" },
}

export const advance = (step: Step, move: Move): Step => NEXT[step]?.[move] ?? step

/** The index of a step in the stepper, from 0. Welcome is -1, done is past the end. */
export function indexOf(step: Step, hosted: boolean): number {
  const steps = stepsFor(hosted)
  return step === "done" ? steps.length : steps.findIndex((s) => s.step === step)
}
