export type Step = "sign-in" | "cloudflare" | "connect" | "model" | "done"
export type Move = "next" | "skip"

export const stepsFor = (hosted: boolean): readonly { step: Step; label: string }[] => [
  { step: "sign-in", label: "Sign in" },
  ...(hosted ? [{ step: "cloudflare" as const, label: "Cloudflare" }] : []),
  { step: "connect", label: "Provider" },
  { step: "model", label: "Model" },
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
  if (f.saved === "model") return f.connected || !f.known ? "model" : "connect"
  if (f.known) return f.connected ? "model" : "connect"
  return f.fresh ? "connect" : "done"
}

export function stepFromSaved(value: string | null): Step | null {
  return value === "connect" || value === "model" || value === "done" ? value : null
}

const NEXT: Partial<Record<Step, Record<Move, Step>>> = {
  connect: { next: "model", skip: "done" },
  model: { next: "done", skip: "done" },
}

export const advance = (step: Step, move: Move): Step => NEXT[step]?.[move] ?? step

export function indexOf(step: Step, hosted: boolean): number {
  const steps = stepsFor(hosted)
  return step === "done" ? steps.length : steps.findIndex((s) => s.step === step)
}

