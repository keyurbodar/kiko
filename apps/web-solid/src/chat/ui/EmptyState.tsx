import "./empty-state.css"

/** A new chat opens to one heading with the composer under it. The first send carries the composer down to the dock. */
export function EmptyState() {
  return (
    <div class="chat-empty motion-view-in" data-component="chat-empty">
      <h1 class="font-display text-[30px] font-extrabold leading-tight tracking-[-0.025em] text-foreground sm:text-[38px]">What's on your mind?</h1>
    </div>
  )
}

/** A chat whose stored messages are still loading: a few bubble shapes, faded in only once the wait is long enough to notice. */
export function ThreadSkeleton() {
  return (
    <div class="thread-skeleton motion-busy" data-late="" data-component="thread-skeleton" aria-hidden="true">
      <span class="motion-skeleton" style={{ width: "52%" }} />
      <span class="motion-skeleton" style={{ width: "34%" }} />
      <span class="motion-skeleton" data-side="user" style={{ width: "40%" }} />
      <span class="motion-skeleton" style={{ width: "58%" }} />
    </div>
  )
}

