import type { PageView, Step } from "../page/types"

export type Choice = { key: string; text: string; step: Step | { op: "done" } | { op: "stuck" } }

export type DecideInput = {
  goal: string
  values: Record<string, string>
  page: PageView
  options: Choice[]
  history: string[]
}

/** `after`: more choices to run after this one before the next read. The worker keeps only a safe prefix. */
export type Decision = { choice: Choice; confidence: number | null; runnersUp: Choice[]; after?: Choice[] }

export interface Decider {
  readonly name: string
  decide(input: DecideInput, signal: AbortSignal): Promise<Decision>
}
