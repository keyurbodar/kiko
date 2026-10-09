import { For, Show } from "solid-js"
import { Bird } from "../mascot/bird"
import type { BirdState } from "../mascot/birds"
import { identityLook } from "./identity"

/*
 * The only component that draws a bot or a chat: its bird, on nothing. Still by default:
 * a list of moving avatars is motion where nobody is waiting for anything. A `state` makes
 * the bird act out what the agent is doing. `size` is in pixels. Omit it to size by class.
 */
export function IdentityAvatar(props: { seed: string; size?: number; class?: string; state?: BirdState }) {
  const look = () => identityLook(props.seed)
  return (
    <span
      class={`inline-flex shrink-0 align-middle ${props.class ?? ""}`}
      style={{
        width: props.size ? `${props.size}px` : undefined,
        height: props.size ? `${props.size}px` : undefined,
        "--identity-color": look().color,
      }}
      data-component="identity-avatar"
      data-seed={props.seed}
      aria-hidden="true"
    >
      <Bird slug={look().seed} state={props.state} class="size-full" />
    </span>
  )
}

/*
 * Where each face of a group sits, as fractions of the box: a dango huddle, the way Shima Enaga
 * fledglings line up shoulder to shoulder on a branch. Two sit side by side; three sit with the
 * first face (the chief) in front and the others peeking out behind it. `s` is the face's size
 * and `z` its stacking order. Every face stays inside the box, so a group takes the room of a
 * single avatar.
 */
const LAYOUT: Record<number, readonly Spot[]> = {
  2: [
    { x: 0.02, y: 0.2, s: 0.6, z: 0 },
    { x: 0.38, y: 0.2, s: 0.6, z: 1 },
  ],
  3: [
    { x: 0.2, y: 0.32, s: 0.6, z: 2 },
    { x: 0.02, y: 0.12, s: 0.5, z: 0 },
    { x: 0.48, y: 0.12, s: 0.5, z: 1 },
  ],
}

type Spot = { x: number; y: number; s: number; z: number }

/** Where a bird's round body sits in its box, as fractions: its center and its radius. */
const BODY = { cx: 0.52, cy: 0.52, r: 0.36 }

/**
 * The mask that cuts a 2 px ring out of a face wherever a face stacked above it sits on it, so
 * each bird reads on its own, as stacked avatars do in Telegram. The ring follows the bird's
 * round body, not its square box. A cut, not a painted ring, so the gap shows whatever surface
 * is behind: a row, a hovered row, a tab, or the panel.
 */
function cutout(spots: readonly Spot[], index: number): Record<string, string> {
  const me = spots[index]!
  const holes = spots
    .filter((other) => other.z > me.z)
    .map((other) => {
      // The other bird's body, in percent of this face's box. The box is square, so an
      // ellipse with equal percentages is a circle.
      const cx = ((other.x + other.s * BODY.cx - me.x) / me.s) * 100
      const cy = ((other.y + other.s * BODY.cy - me.y) / me.s) * 100
      const r = ((other.s * BODY.r) / me.s) * 100
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
          class={`relative inline-block shrink-0 align-middle leading-none ${props.class ?? ""}`}
          style={{ width: props.size ? `${props.size}px` : undefined, height: props.size ? `${props.size}px` : undefined }}
          data-component="chat-avatar-stack"
          data-faces={props.faces.length}
          aria-hidden="true"
        >
          <For each={spots()}>
            {(spot, i) => (
              <span
                // `flex`, not inline: an inline face sits on a text line whose strut is
                // taller than the face, which pushed small group faces down and left.
                class="absolute flex"
                style={{
                  "z-index": spot.z,
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
