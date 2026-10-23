import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai"

export type Question = ClassifierQuestion
export type Answer = ClassifierAnswer

export type Judge = <K extends string>(
  state: JsonObject,
  questions: Record<K, Question>,
) => Promise<Record<K, Answer> | null>

export const boolOf = (answer: Answer | undefined): number => (answer?.type === "bool" ? answer.probability : 0)

export const choiceOf = (answer: Answer | undefined): { choice: string; p: number } | null =>
  answer?.type === "choice"
    ? { choice: answer.choice, p: answer.probabilities[answer.choice] ?? answer.confidence }
    : null
