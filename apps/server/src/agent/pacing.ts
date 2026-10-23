type Part = { type: string; text?: string }

export type Assistant = {
  role?: string
  stopReason?: string
  errorMessage?: string
  provider?: string
  content?: readonly Part[]
}

type Post = "ack" | "answer" | "none"

export const hasToolCall = (message: Assistant | undefined): boolean =>
  (message?.content ?? []).some((part) => part.type === "toolCall")

export function postOf(message: Assistant, seen: { posted: boolean; quiet: boolean }): Post {
  if (message.stopReason === "aborted" || message.stopReason === "error") return "none"
  if (!hasToolCall(message)) return "answer"
  if (seen.quiet) return "none"
  return seen.posted ? "none" : "ack"
}

const ACK_CHARS = 200

export function ackOf(text: string): string {
  const line =
    text
      .split("\n")
      .find((part) => part.trim() !== "")
      ?.trim() ?? ""
  return line.length > ACK_CHARS ? `${line.slice(0, ACK_CHARS - 1)}…` : line
}

const NOTE_CHARS = 2_000

export function noteOf(text: string): string {
  const body = text.trim()
  return body.length > NOTE_CHARS ? `${body.slice(0, NOTE_CHARS - 1)}…` : body
}
