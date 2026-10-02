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
 * Every face stays inside the box, so a group takes the room of a single avatar.
 */
const LAYOUT: Record<number, readonly Spot[]> = {
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

type Spot = { x: number; y: number; s: number }

/**
 * The mask that cuts a 2 px ring out of a face wherever a later face sits on it, so each face
 * reads on its own, as stacked avatars do in Telegram. A cut, not a painted ring, so the gap
 * shows whatever surface is behind: a row, a hovered row, a tab, or the panel.
 */
function cutout(spots: readonly Spot[], index: number): Record<string, string> {
  const me = spots[index]!
  const holes = spots.slice(index + 1).map((other) => {
    // The later face's centre and radius, in percent of this face's box. The box is square,
    // so an ellipse with equal percentages is a circle.
    const cx = ((other.x + other.s / 2 - me.x) / me.s) * 100
    const cy = ((other.y + other.s / 2 - me.y) / me.s) * 100
    const r = (other.s / 2 / me.s) * 100
    return `radial-gradient(calc(${r}% + 2px) calc(${r}% + 2px) at ${cx}% ${cy}%, transparent 99%, #000 100%)`
  })
  if (!holes.length) return {}
  const mask = holes.join(", ")
  return { "mask-image": mask, "-webkit-mask-image": mask, "mask-composite": "intersect", "-webkit-mask-composite": "source-in" }
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
                class="absolute rounded-full"
                style={{
                  left: `${spot.x * 100}%`,
                  top: `${spot.y * 100}%`,
                  width: `${spot.s * 100}%`,
                  height: `${spot.s * 100}%`,
                  ...cutout(spots(), i()),
                }}
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
