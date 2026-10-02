import { For, Show, createSignal, onCleanup, type JSX } from "solid-js"
import type { Approval, ApprovalState } from "@kiko/protocol"

/*
 * Approval cards (P7-02, architecture sections 12.3 and 16.3). A tainted run asked to act outside
 * kiko and only the human can say yes. The card sits like an incoming bubble above the composer:
 * who asks, the tool, a plain summary of the arguments, why it needs an ok, and two buttons.
 *
 * Loaded lazily by the chat route, and only when the room has a card, so the transcript chunk
 * does not carry it. Deciding is optimistic: the store overlays the new state at once and the
 * room's `approval` event confirms it.
 */

const LABEL: Record<Exclude<ApprovalState, "pending">, string> = {
  accepted: "approved",
  declined: "declined",
  expired: "expired, ask again if it still matters",
}

/** The state to show. A pending card past its time reads as expired before the room says so. */
const shownState = (a: Approval, now: number): ApprovalState => (a.state === "pending" && a.expiresAt <= now ? "expired" : a.state)

export default function ApprovalCards(props: {
  approvals: readonly Approval[]
  onDecide: (id: string, action: "accept" | "decline") => void
}): JSX.Element {
  /*
   * Pending cards show, and a card stays after it is decided while this chat is open, so the human
   * sees what their tap did. An old decided card from an earlier visit stays out of the way.
   */
  const seen = new Set<string>()
  const visible = () =>
    props.approvals.filter((a) => {
      if (a.state === "pending") seen.add(a.id)
      return seen.has(a.id)
    })

  const [now, setNow] = createSignal(Date.now())
  // One tick a second only while a card is pending, so an expired card flips without a server event.
  const timer = setInterval(() => {
    if (props.approvals.some((a) => a.state === "pending")) setNow(Date.now())
  }, 1_000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="mx-auto mb-2 flex w-full max-w-[720px] flex-col items-start gap-2" data-component="approval-cards">
      <For each={visible()}>
        {(a) => {
          const state = () => shownState(a, now())
          return (
            <div
              class="flex w-full max-w-[420px] flex-col gap-1 rounded-bubble bg-message-assistant px-(--bubble-pad-x) py-(--bubble-pad-y) text-message-assistant-text"
              role="group"
              aria-label={`approval for ${a.tool}`}
              data-component="approval-card"
              data-approval-id={a.id}
              data-state={state()}
            >
              <span class="text-sm text-[var(--accent)]">{a.slug} wants to act outside kiko</span>
              <span class="font-medium break-all">{a.tool}</span>
              <span class="text-base wrap-break-word">{a.summary}</span>
              <span class="text-sm text-text-muted">this run read outside content, so it needs your ok first.</span>
              <Show
                when={state() === "pending"}
                fallback={
                  <span class="pt-1 text-sm text-text-muted" role="status" data-component="approval-state">
                    {LABEL[state() as Exclude<ApprovalState, "pending">]}
                  </span>
                }
              >
                <div class="flex gap-2 pt-2">
                  <button
                    type="button"
                    class="flex-1 rounded-xl bg-bg-subtle px-3 py-1.5 text-sm text-text"
                    data-component="approval-decline"
                    onClick={() => props.onDecide(a.id, "decline")}
                  >
                    decline
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-sm text-[var(--on-accent)]"
                    data-component="approval-accept"
                    onClick={() => props.onDecide(a.id, "accept")}
                  >
                    approve
                  </button>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}
