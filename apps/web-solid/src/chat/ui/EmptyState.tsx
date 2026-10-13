import { Show } from "solid-js"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import "./empty-state.css"

/*
 * The empty chat, after monocode's empty session: the chat's avatars and a heading sit in the
 * middle of the pane, and the composer sits under them, so the first send can carry it down to
 * the dock.
 */
export function EmptyState(props: { faces: readonly string[]; names: readonly string[] }) {
  const who = () => {
    const n = props.names
    return n.length < 2 ? "" : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`
  }
  return (
    <div class="chat-empty" data-component="chat-empty">
      <ChatAvatar faces={props.faces} size={72} />
      <h1 class="chat-empty-title">What's on your mind?</h1>
      <Show when={who()}>
        <p class="chat-empty-who">{who()}</p>
      </Show>
    </div>
  )
}
