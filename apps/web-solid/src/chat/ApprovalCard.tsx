import { For, createSignal, onCleanup, type JSX } from "solid-js"
import type { Approval } from "@kiko/protocol"

/*
 * Approval cards (P7-02, architecture sections 12.3 and 16.3). An agent asked to act outside kiko
 * and only the human can say yes. A card sits above the composer only while it waits: one line that
 * says what the agent wants, two buttons, and the raw call behind "details". Once the human answers
 * it leaves at once; the agent's reply is the confirmation. A card past its time leaves too.
 *
 * Loaded lazily by the chat route, and only when the room has a card, so the transcript chunk
 * does not carry it. Deciding is optimistic: the store overlays the new state at once and the
 * room's `approval` event confirms it.
 */

/** What the agent wants, in one plain line. Executor tools read as the human's connected apps. */
function title(a: Approval): string {
  const apps = a.tool.startsWith("executor_")
  if (a.grantMs) return `${a.slug} wants to use ${apps ? "your connected apps" : a.tool.replace(/_/g, " ")} for ${Math.round(a.grantMs / 60_000)} minutes`
  if (apps) return `${a.slug} wants to go ahead with an action in your connected apps`
  return `${a.slug} wants to use ${a.tool.replace(/_/g, " ")}`
}

export default function ApprovalCards(props: {
  approvals: readonly Approval[]
  onDecide: (id: string, action: "accept" | "decline") => void
}): JSX.Element {
  const [now, setNow] = createSignal(Date.now())
  // One tick a second only while a card waits, so an expired card leaves without a server event.
  const timer = setInterval(() => {
    if (props.approvals.some((a) => a.state === "pending")) setNow(Date.now())
  }, 1_000)
  onCleanup(() => clearInterval(timer))
  const waiting = () => props.approvals.filter((a) => a.state === "pending" && a.expiresAt > now())

  return (
    <div class="mx-auto mb-2 flex w-full max-w-[720px] flex-col gap-2" data-component="approval-cards">
      <For each={waiting()}>
        {(a) => (
          <div
            class="flex w-full flex-col gap-1.5 rounded-2xl bg-message-assistant px-4 py-2.5 text-message-assistant-text"
            role="group"
            aria-label={`Approval for ${a.tool}`}
            data-component="approval-card"
            data-approval-id={a.id}
            data-state={a.state}
          >
            <div class="flex items-center gap-3">
              <p class="min-w-0 flex-1 text-sm" data-component="approval-title">
                {title(a)}
              </p>
              <button
                type="button"
                class="h-8 shrink-0 rounded-[10px] bg-bg-subtle px-3 text-sm text-text"
                data-component="approval-decline"
                onClick={() => props.onDecide(a.id, "decline")}
              >
                Decline
              </button>
              <button
                type="button"
                class="h-8 shrink-0 rounded-[10px] bg-[var(--accent-fill)] px-3 text-sm text-[var(--on-accent)]"
                data-component="approval-accept"
                onClick={() => props.onDecide(a.id, "accept")}
              >
                Approve
              </button>
            </div>
            <details class="text-xs text-text-muted" data-component="approval-details">
              <summary class="w-fit cursor-default select-none">Details</summary>
              <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs">
                {a.tool}
                {"\n"}
                {a.summary}
              </pre>
            </details>
          </div>
        )}
      </For>
    </div>
  )
}
