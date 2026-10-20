export type Step = "sign-in" | "cloudflare" | "connect" | "done"
export type Move = "next" | "skip"

export const stepsFor = (hosted: boolean): readonly { step: Step; label: string }[] => [
  { step: "sign-in", label: "Sign in" },
  ...(hosted ? [{ step: "cloudflare" as const, label: "Cloudflare" }] : []),
  { step: "connect", label: "Provider" },
]

export interface Facts {
  signedIn: boolean
  hosted: boolean
  needsBackend: boolean
  saved: Step | null
  fresh: boolean
  known: boolean
  connected: boolean
  onboarded: boolean
}

export function stepFor(f: Facts): Step {
  if (!f.signedIn) return f.hosted && f.needsBackend ? "cloudflare" : "sign-in"
  if (f.saved === "done" || (f.known && f.onboarded)) return "done"
  if (f.saved === "connect") return "connect"
  if (f.known) return f.connected ? "done" : "connect"
  return f.fresh ? "connect" : "done"
}

export function stepFromSaved(value: string | null): Step | null {
  if (value === "model") return "connect"
  return value === "connect" || value === "done" ? value : null
}

const NEXT: Partial<Record<Step, Record<Move, Step>>> = {
  connect: { next: "done", skip: "done" },
}

export const advance = (step: Step, move: Move): Step => NEXT[step]?.[move] ?? step

export function indexOf(step: Step, hosted: boolean): number {
  const steps = stepsFor(hosted)
  return step === "done" ? steps.length : steps.findIndex((s) => s.step === step)
}

export const shownModel = (chosen: string | null, running: string | undefined, listed: readonly string[]): string | undefined =>
  chosen ?? (running && listed.includes(running) ? running : undefined)

export const modelToSave = (shown: string | undefined, running: string | undefined): string | null => (shown && shown !== running ? shown : null)
