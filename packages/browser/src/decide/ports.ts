export type JevOption = { key: string; text: string }

export type JevChoose = {
  state: Record<string, unknown>
  instructions: string
  options: JevOption[]
}

export type JevAnswer = { key: string; probabilities: Record<string, number>; confidence: number }

export type JevNoul = {
  state: Record<string, unknown>
  questions: { key: string; instructions: string }[]
}

/** The two things the browser asks of Jev. The server wires the real HTTP calls. */
export type JevPort = {
  choose(req: JevChoose, signal: AbortSignal): Promise<JevAnswer>
  /** One yes-or-no question per key, in one request. Returns the probability of yes per key. */
  noul?(req: JevNoul, signal: AbortSignal): Promise<Record<string, number>>
}

/** Any chat model. The agent's own model is the default decider. */
export type ModelPort = {
  complete(system: string, user: string, signal: AbortSignal): Promise<string>
}
