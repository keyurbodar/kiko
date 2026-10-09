import { lazy, Show, Suspense } from "solid-js"
import "./empty-state.css"

// The picture loads on its own, so a chat with messages never fetches it.
const Hoarfrost = lazy(() => import("../../mascot/hoarfrost").then((m) => ({ default: m.Hoarfrost })))

/*
 * The empty chat, after monocode's empty session: a frosted branch with a huddle of Shima Enaga
 * fills the top of the pane (`mascot/hoarfrost`), and a heading sits over the composer in the middle. The route puts the
 * composer under the heading, so the first send can carry it down to the dock.
 */
export function EmptyState(props: { faces: readonly string[]; names: readonly string[] }) {
  const who = () => {
    const n = props.names
    return n.length < 2 ? "" : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`
  }
  return (
    <>
      <Suspense>
        <Hoarfrost />
      </Suspense>
      <div class="chat-empty" data-component="chat-empty">
        <h1 class="chat-empty-title">What's on your mind?</h1>
        <Show when={who()}>
          <p class="chat-empty-who">{who()}</p>
        </Show>
      </div>
    </>
  )
}
