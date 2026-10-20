/*
 * Pacing: what of one run becomes chat bubbles. A run's answer is the assistant message that ends the turn. Every
 * message before it either narrates a tool call or is an answer of its own. Without this rule a model that says
 * "Retrying SRK photos." before each of eight calls puts eight bubbles in the chat.
 *
 * The rule, as data. A message WITH tool calls is narration: the first narration of a run is the ack, one short bubble
 * so the human sees the agent heard them, and later narration belongs to the run's step pane. A message with no tool
 * call is the answer and becomes bubbles. A quiet run, one answering a system event, posts nothing either way.
 */

type Part = { type: string; text?: string }

export type Assistant = { role?: string; stopReason?: string; errorMessage?: string; provider?: string; content?: readonly Part[] }

/** What one finished assistant message becomes: the ack bubble, the answer's bubbles, or nothing in the chat. */
type Post = "ack" | "answer" | "none"

export const hasToolCall = (message: Assistant | undefined): boolean => (message?.content ?? []).some((part) => part.type === "toolCall")

/** `posted` is true once the run has put a bubble in the chat: the ack or any earlier answer. */
export function postOf(message: Assistant, seen: { posted: boolean; quiet: boolean }): Post {
  if (message.stopReason === "aborted" || message.stopReason === "error") return "none"
  if (!hasToolCall(message)) return "answer"
  if (seen.quiet) return "none"
  return seen.posted ? "none" : "ack"
}

/** The ack's words: one short line, so eight narrations never stack into eight bubbles. */
const ACK_CHARS = 200

export function ackOf(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "")?.trim() ?? ""
  return line.length > ACK_CHARS ? `${line.slice(0, ACK_CHARS - 1)}…` : line
}

/** A narration as the step pane shows it. The room cuts its own label column; this keeps a request from growing unbounded. */
const NOTE_CHARS = 2_000

export function noteOf(text: string): string {
  const body = text.trim()
  return body.length > NOTE_CHARS ? `${body.slice(0, NOTE_CHARS - 1)}…` : body
}
