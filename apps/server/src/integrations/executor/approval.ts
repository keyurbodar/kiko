import type { ApprovalAnswer, ApprovalRequest } from "../../room/approvals"

// Architecture section 12.3. Executor v2 pauses a program for the human and returns it as JSON:
// `{status: "approval-required" | "input-required", requestId, elicitation, expiresAt}`. A model must
// never answer its own pause: the resume tool runs only against an approval card the human accepted.
// The card is posted the moment the pause comes back, through the room's approvals (P7-02); the
// human's decision reaches the agent as an `approval_result` envelope, and the card lasts as long as
// Executor holds the program.
//
// This file is the one place an Executor tool name appears in yuki (the plan allows it here).

/** Executor's tool that continues a paused program. */
export const RESUME_TOOL = "resume"

/** How long Executor v2 holds a paused program (`defaultToolApprovalLimits`). */
const HOLD_MS = 15 * 60_000

/** A program waiting on the human. `apr_` ids are consent to a call, `elc_` ids ask for form fields. */
export type Pending = { requestId: string; kind: "approval" | "input"; message: string; expiresAt: number }

/** The pause in a tool result's text, or null when the program did not pause. */
export function pendingInteraction(text: string): Pending | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== "object") return null
  const v = value as { status?: unknown; requestId?: unknown; expiresAt?: unknown; elicitation?: { message?: unknown } }
  if ((v.status !== "approval-required" && v.status !== "input-required") || typeof v.requestId !== "string") return null
  return {
    requestId: v.requestId,
    kind: v.status === "approval-required" ? "approval" : "input",
    message: typeof v.elicitation?.message === "string" ? v.elicitation.message : "",
    expiresAt: typeof v.expiresAt === "number" ? v.expiresAt : Date.now() + HOLD_MS,
  }
}

/**
 * What resume sends once the human accepted. Consent to a call carries no fields, so a model cannot
 * change the approved arguments through it. A form question carries the fields the human gave.
 */
export function acceptResponse(requestId: string, content: unknown): { action: "accept"; content: Record<string, unknown> } {
  const fields = requestId.startsWith("elc_") && content && typeof content === "object" ? (content as Record<string, unknown>) : {}
  return { action: "accept", content: fields }
}

/** The room's cards, as Executor uses them: post a pause card, or ask whether the human accepted it. Null: no room. */
export type ApprovalGate = (req: Extract<ApprovalRequest, { kind: "pause" | "resume" }>) => Promise<ApprovalAnswer | null>
