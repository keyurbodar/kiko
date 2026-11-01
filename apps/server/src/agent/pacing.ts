type Part = { type: string; text?: string }

export type Assistant = {
  role?: string
  stopReason?: string
  errorMessage?: string
  provider?: string
  content?: readonly Part[]
}

type Post = "answer" | "none"

export const hasToolCall = (message: Assistant | undefined): boolean =>
  (message?.content ?? []).some((part) => part.type === "toolCall")

export function postOf(message: Assistant): Post {
  if (message.stopReason === "aborted" || message.stopReason === "error") return "none"
  return hasToolCall(message) ? "none" : "answer"
}

const NOTE_CHARS = 2_000

export function noteOf(text: string): string {
  const body = text.trim()
  return body.length > NOTE_CHARS ? `${body.slice(0, NOTE_CHARS - 1)}…` : body
}
