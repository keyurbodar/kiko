/**
 * The no-messages state. It sits in the scroller rather than beside it, so an
 * empty thread still lays out as a centred measure on the app background and
 * the fades above it have nothing to mask.
 */
export function EmptyState(props: { hint?: string }) {
  return (
    <div class="chat-empty" data-component="chat-empty">
      <span class="chat-empty__text">
        {props.hint ?? "no messages yet. say something to start the thread."}
      </span>
    </div>
  )
}
