import "./empty-state.css"

/** A new chat opens to one heading with the composer under it. The first send carries the composer down to the dock. */
export function EmptyState() {
  return (
    <div class="chat-empty" data-component="chat-empty">
      <h1 class="text-2xl font-normal tracking-tight text-foreground sm:text-3xl">What's on your mind?</h1>
    </div>
  )
}
