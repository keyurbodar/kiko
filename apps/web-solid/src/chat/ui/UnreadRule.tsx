/**
 * The new-messages rule. `retiring` collapses the row to zero height by way of
 * a `0fr` grid track, so the line is simply gone the moment the viewer sends —
 * nothing animates and nothing is kept mounted waiting for a timeout.
 */
export function UnreadRule(props: { retiring: boolean }) {
  return (
    <div class="chat-unread-slot" data-retiring={props.retiring ? "" : undefined}>
      <div class="chat-unread-clip">
        <div class="chat-unread" data-component="chat-unread-rule" role="separator" aria-label="new messages">
          <span class="chat-unread__label">new messages</span>
        </div>
      </div>
    </div>
  )
}
