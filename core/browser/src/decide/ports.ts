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

// The server wires the real HTTP calls.
export type JevPort = {
  choose(req: JevChoose, signal: AbortSignal): Promise<JevAnswer>
  noul?(req: JevNoul, signal: AbortSignal): Promise<Record<string, number>>
}

export type ModelPort = {
  complete(system: string, user: string, signal: AbortSignal): Promise<string>
}
