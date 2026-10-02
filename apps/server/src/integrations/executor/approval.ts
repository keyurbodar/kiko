// Architecture section 12.3, P7-05. Executor can pause an execution for the human's approval and
// return its executionId. A model must never approve its own paused execution: the resume tool runs
// only against an approval card the human accepted. The card is posted the moment the pause comes
// back, through the room's approvals (P7-02); the human's decision reaches the agent as an
// `approval_result` envelope, and cards expire with Executor's 4-minute hold.
//
// This file is the one place an Executor tool name appears in kiko (the plan allows it here).

/** Executor's tool that continues a paused execution. */
export const RESUME_TOOL = "resume"

/** The paused execution's id in a tool result, or null. UNVERIFIED: the exact wording of a pause. */
export function pausedExecution(text: string): string | null {
  if (!/paus|approv|waiting|requires? (human|user)/i.test(text)) return null
  const m = /executionId["'`]?\s*[:=]\s*["'`]?([A-Za-z0-9_-]{6,})/.exec(text) ?? /execution[ _-]?id[^A-Za-z0-9]+([A-Za-z0-9_-]{6,})/i.exec(text)
  return m ? m[1]! : null
}

/** The approval gate's answer: the accepted card's id, the text that ends the call, or null (no gate). */
export type ApprovalGate = (callKey: string, tool: string, args: Record<string, unknown>) => Promise<string | { refused: string } | null>
