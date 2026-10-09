import { lazy, Show, Suspense } from "solid-js"
import "./empty-state.css"

// The room loads on its own, so a chat with messages never fetches it; the wall paints at once.
const Nook = lazy(() => import("../../mascot/nook").then((m) => ({ default: m.Nook })))

/*
 * The empty chat: Yuki's window nook (`mascot/nook.tsx`), a warm room with snow falling outside.
 * The whole pane is the room's wall, lit warm in the middle and soft in the corners, so the room
 * fills the screen. The heading sits under the window and the route puts the composer under
 * that, so the first send can carry it down to the dock.
 */
export function EmptyState(props: { faces: readonly string[]; names: readonly string[] }) {
  const who = () => {
    const n = props.names
    return n.length < 2 ? "" : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`
  }
  return (
    <>
      <div class="chat-empty-wall" aria-hidden="true" />
      <div class="chat-empty" data-component="chat-empty">
        <Suspense fallback={<div class="nook-placeholder" />}>
          <Nook faces={props.faces} />
        </Suspense>
        <h1 class="chat-empty-title">What's on your mind?</h1>
        <Show when={who()}>
          <p class="chat-empty-who">{who()}</p>
        </Show>
      </div>
    </>
  )
}
