import { lazy, Suspense } from "solid-js"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"

// The pixel field loads on its own, so a chat with messages never fetches it.
const BirdGrid = lazy(() => import("./bird-grid"))

/**
 * The no-messages state: the chat's own agents as pixel birds pecking at seeds, and one quiet line.
 * No instructions; the composer's placeholder already says who to message.
 */
export function EmptyState(props: { class?: string }) {
  return (
    <div
      class={cn(
        "chat-empty pointer-events-none flex flex-1 select-none flex-col items-center justify-center gap-5 px-4",
        props.class,
      )}
      data-component="chat-empty"
      aria-hidden="true"
    >
      <Suspense>
        <BirdGrid faces={useApp.chatFaces(useApp.activeThreadId() ?? "")} />
      </Suspense>
      <p class="text-[15px] font-medium text-weak">what's on your mind?</p>
    </div>
  )
}
