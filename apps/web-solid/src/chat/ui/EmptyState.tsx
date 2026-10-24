import "./empty-state.css"

export function EmptyState() {
  return (
    <div class="chat-empty" data-component="chat-empty">
      <h1 class="font-display text-[32px] leading-10 font-normal text-fg [font-variation-settings:var(--display-variation)] sm:text-[40px] sm:leading-[44px]">
        What's on your mind?
      </h1>
    </div>
  )
}
