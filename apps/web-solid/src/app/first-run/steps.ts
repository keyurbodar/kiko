/*
 * The first-run steps as data. `stepFor` is the one rule for what a person sees: it reads facts
 * (signed in or not, what this browser saved, what the server says is connected) and answers a
 * step, or "done" when first run has nothing to show. `advance` moves one step on a button.
 *
 * Three cards at most. The welcome copy is the cover of the sign-in step, and the model is part of
 * the connect step, so a hosted build is sign in, Cloudflare, provider, and a self-hosted one is
 * sign in, provider.
 */
export type Step = "sign-in" | "cloudflare" | "connect" | "done"
export type Move = "next" | "skip"

/** The steps the stepper counts, in order, with their labels. */
export const stepsFor = (hosted: boolean): readonly { step: Step; label: string }[] => [
  { step: "sign-in", label: "Sign in" },
  ...(hosted ? [{ step: "cloudflare" as const, label: "Cloudflare" }] : []),
  { step: "connect", label: "Provider" },
]

export interface Facts {
  signedIn: boolean
  hosted: boolean
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
  if (!f.signedIn) return f.hosted && f.needsBackend ? "cloudflare" : "sign-in"
  if (f.saved === "done" || (f.known && f.onboarded)) return "done"
  // Connect holds the model and "Start chatting" now, so connecting a provider does not move on by itself.
  if (f.saved === "connect") return "connect"
  if (f.known) return f.connected ? "done" : "connect"
  return f.fresh ? "connect" : "done"
}

/** A step this browser saved. A build before this one saved the model screen; it is part of connect now. */
export function stepFromSaved(value: string | null): Step | null {
  if (value === "model") return "connect"
  return value === "connect" || value === "done" ? value : null
}

const NEXT: Partial<Record<Step, Record<Move, Step>>> = {
  connect: { next: "done", skip: "done" },
}

export const advance = (step: Step, move: Move): Step => NEXT[step]?.[move] ?? step

/** The index of a step in the stepper, from 0. Done is past the end. */
export function indexOf(step: Step, hosted: boolean): number {
  const steps = stepsFor(hosted)
  return step === "done" ? steps.length : steps.findIndex((s) => s.step === step)
}

/** What the connect step shows as picked: the human's click, else the model Kiko already runs on if it is listed, else the first row. */
export const shownModel = (chosen: string | null, running: string | undefined, listed: readonly string[]): string | undefined =>
  chosen ?? (running && listed.includes(running) ? running : undefined)

/** The model to save when the step ends: the shown row, when it is not what Kiko already runs on. */
export const modelToSave = (shown: string | undefined, running: string | undefined): string | null => (shown && shown !== running ? shown : null)
