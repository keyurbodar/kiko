import { lazy, Suspense } from "solid-js"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"
import { daypartOf, GREETING } from "../../mascot/scene"

// The perch loads on its own, so a chat with messages never fetches it.
const Perch = lazy(() => import("../../mascot/perch"))

/**
 * The no-messages state: the chat's own birds huddled on a birch twig, and one quiet line for
 * the time of day. No instructions; the composer's placeholder already says who to message.
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
        <Perch faces={useApp.chatFaces(useApp.activeThreadId() ?? "")} />
      </Suspense>
      <p class="text-md leading-relaxed text-muted">{GREETING[daypartOf(new Date())]}</p>
    </div>
  )
}
