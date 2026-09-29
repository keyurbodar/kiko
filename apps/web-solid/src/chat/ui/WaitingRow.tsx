import { For, Show } from "solid-js";
import { Avatar } from "@kiko/ui/v2/avatar-v2";

export function typingLabel(names: readonly string[]): string {
  const [first, second] = names;
  if (names.length === 1) return `${first} is typing...`;
  if (names.length === 2) return `${first} and ${second} are typing...`;
  if (names.length === 3) return `${first}, ${second}, and ${names[2]} are typing...`;
  return `${first}, ${second}, and ${names.length - 2} others are typing...`;
}

export function WaitingRow(props: { names: readonly string[] }) {
  return (
    <Show when={props.names.length > 0}>
      <div
        class="chat-waiting"
        data-component="chat-waiting"
        role="status"
        aria-live="polite"
        aria-label={typingLabel(props.names)}
      >
        <div class="chat-waiting__rail" data-component="chat-waiting-rail">
          <Avatar fallback={props.names[0]} size="large" />
        </div>
        <div class="chat-waiting__cell" data-component="chat-waiting-cell">
          <span class="chat-waiting__label" data-component="chat-waiting-label">
            {typingLabel(props.names)}
          </span>
          <span class="chat-waiting__dots" data-component="chat-waiting-dots" aria-hidden="true">
            <For each={[0, 1, 2]}>{(index) => <span data-index={String(index)} />}</For>
          </span>
        </div>
      </div>
    </Show>
  );
}
