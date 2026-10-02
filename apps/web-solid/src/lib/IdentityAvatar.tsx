import { Blobatar } from "@blobatar/solid"
import { For, Show } from "solid-js"
import { identityLook } from "./identity"

/*
 * The only component that draws a bot or a chat. Static, never `animate`: a
 * list of moving avatars is motion in a place the user is not waiting for
 * anything. `size` is in pixels. Omit it to let the parent's class size it.
 */
export function IdentityAvatar(props: { seed: string; size?: number; class?: string }) {
  const look = () => identityLook(props.seed)
  return (
    <span
      class={`inline-block shrink-0 overflow-hidden rounded-full ${props.class ?? ""}`}
      style={{
        width: props.size ? `${props.size}px` : undefined,
        height: props.size ? `${props.size}px` : undefined,
        "--identity-color": look().color,
      }}
      data-component="identity-avatar"
      data-seed={props.seed}
      aria-hidden="true"
    >
      <Blobatar name={look().seed} class="size-full rounded-full" />
    </span>
  )
}

/*
 * Where each face of a group sits, as fractions of the box: kat's group tile is one blob on
 * top and two below, overlapping, and two members sit on the diagonal. `s` is the face's size.
 */
const LAYOUT: Record<number, readonly { x: number; y: number; s: number }[]> = {
  2: [
    { x: 0, y: 0, s: 0.62 },
    { x: 0.38, y: 0.38, s: 0.62 },
  ],
  3: [
    { x: 0.24, y: 0, s: 0.52 },
    { x: 0, y: 0.46, s: 0.54 },
    { x: 0.46, y: 0.46, s: 0.54 },
  ],
}

/**
 * A chat's avatar: its one agent's face, or for a group a stack of up to three member faces.
 * `faces` comes from `useApp.chatFaces`. Sized like `IdentityAvatar`: by `size` or by `class`.
 */
export function ChatAvatar(props: { faces: readonly string[]; size?: number; class?: string }) {
  const layout = () => LAYOUT[Math.min(props.faces.length, 3)]
  return (
    <Show when={layout()} fallback={<IdentityAvatar seed={props.faces[0] ?? ""} size={props.size} class={props.class} />}>
      {(spots) => (
        <span
          class={`relative inline-block shrink-0 ${props.class ?? ""}`}
          style={{ width: props.size ? `${props.size}px` : undefined, height: props.size ? `${props.size}px` : undefined }}
          data-component="chat-avatar-stack"
          data-faces={props.faces.length}
          aria-hidden="true"
        >
          <For each={spots()}>
            {(spot, i) => (
              <span
                class="absolute"
                style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.s * 100}%`, height: `${spot.s * 100}%` }}
              >
                <IdentityAvatar seed={props.faces[i()] ?? ""} class="size-full" />
              </span>
            )}
          </For>
        </span>
      )}
    </Show>
  )
}
