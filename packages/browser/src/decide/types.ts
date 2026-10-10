import type { PageView, Step } from "../page/types"

export type Choice = { key: string; text: string; step: Step | { op: "done" } | { op: "stuck" } }

export type DecideInput = {
  goal: string
  values: Record<string, string>
  page: PageView
  options: Choice[]
  history: string[]
}

export type Decision = { choice: Choice; confidence: number | null; runnersUp: Choice[] }

export interface Decider {
  readonly name: string
  decide(input: DecideInput, signal: AbortSignal): Promise<Decision>
}
