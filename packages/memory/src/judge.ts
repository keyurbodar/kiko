export type Question =
  | { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }

/** Null means no judgment is available (no key, a refused key, a timeout, an error). Never throws. */
export type Judge = <K extends string>(state: unknown, questions: Record<K, Question>) => Promise<Record<K, Answer> | null>

export const noulOf = (answer: Answer | undefined): number => (answer?.type === "noul" ? answer.noul : 0)

export const choiceOf = (answer: Answer | undefined): { choice: string; p: number } | null =>
  answer?.type === "choice" ? { choice: answer.choice, p: answer.probabilities[answer.choice] ?? answer.confidence } : null

/** Checks a response against the questions asked: every key present with the asked type. */
export function answersFor<K extends string>(questions: Record<K, Question>, raw: unknown): Record<K, Answer> | null {
  if (!raw || typeof raw !== "object") return null
  const out = {} as Record<K, Answer>
  for (const key of Object.keys(questions) as K[]) {
    const a = (raw as Record<string, unknown>)[key] as Record<string, unknown> | undefined
    if (!a || a.type !== questions[key].type) return null
    if (a.type === "noul") {
      if (typeof a.noul !== "number") return null
      out[key] = { type: "noul", noul: a.noul }
    } else {
      if (typeof a.choice !== "string" || !a.probabilities || typeof a.probabilities !== "object") return null
      out[key] = { type: "choice", choice: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : 0, probabilities: a.probabilities as Record<string, number> }
    }
  }
  return out
}
