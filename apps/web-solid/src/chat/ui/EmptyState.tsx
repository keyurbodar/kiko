import { For, Show } from "solid-js"
import { Bird } from "../../mascot/bird"
import "./empty-state.css"

/*
 * The empty chat, after monocode's: a heading over the composer, centered in the pane, on a quiet
 * sketchbook dot grid that fills it. Above the heading sit the chat's own birds, one drawing, still
 * but breathing: the one agent, or a group huddled two behind and one in front. The route places
 * the composer under this, so the first send can carry it down to the dock.
 */
export function EmptyState(props: { faces: readonly string[]; names: readonly string[] }) {
  const faces = () => props.faces.slice(0, 3)
  const who = () => {
    const n = props.names
    return n.length < 2 ? "" : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`
  }
  return (
    <div class="chat-empty" data-component="chat-empty" data-faces={faces().length}>
      <div class="chat-empty-birds" aria-hidden="true">
        <For each={faces()}>{(slug, i) => <span class="chat-empty-bird" data-spot={faces().length === 1 ? "solo" : i() === 0 ? "front" : `back-${i()}`}><Bird slug={slug} size={faces().length === 1 ? 84 : i() === 0 ? 76 : 58} alive /></span>}</For>
      </div>
      <h1 class="chat-empty-title">What's on your mind?</h1>
      <Show when={who()}>
        <p class="chat-empty-who">{who()}</p>
      </Show>
    </div>
  )
}
