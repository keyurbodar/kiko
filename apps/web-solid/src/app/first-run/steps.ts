export type Step = "sign-in" | "cloudflare" | "connect" | "model" | "done"
export type Move = "next" | "skip"

export const stepsFor = (hosted: boolean): readonly { step: Step; label: string }[] => [
  { step: "sign-in", label: "Sign in" },
  ...(hosted ? [{ step: "cloudflare" as const, label: "Cloudflare" }] : []),
  { step: "connect", label: "Provider" },
  { step: "model", label: "Model" },
]

export interface Onboarding {
  chosen: Step | null
  fresh: boolean
  known: boolean
  connected: boolean
  onboarded: boolean
}

export function onboardingStep(f: Onboarding): Step {
  if (f.chosen === "done" || (f.known && f.onboarded)) return "done"
  if (f.chosen === "connect") return "connect"
  if (f.chosen === "model") return f.connected || !f.known ? "model" : "connect"
  if (f.known) return f.connected ? "model" : "connect"
  return f.fresh ? "connect" : "done"
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

export const resumedStep = (f: { fresh: boolean; acted: boolean; step: Step }): Step | null =>
  !f.fresh && !f.acted && (f.step === "connect" || f.step === "model") ? f.step : null

export const resumeLine = (step: Step, hosted: boolean): string => {
  const label = stepsFor(hosted).find((s) => s.step === step)?.label ?? "setup"
  return `You stopped at ${label}.${hosted ? " Cloudflare is ready." : ""}`
}
