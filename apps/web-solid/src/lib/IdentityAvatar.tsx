import { cachedUri } from "@kiko/avatar/uri"
import { For, Show } from "solid-js"
import { pinsFor } from "../avatar/picks"
import { identityLook } from "./identity"

export function IdentityAvatar(props: { seed: string; size?: number; class?: string }) {
  return (
    <span
      class={`inline-flex shrink-0 align-middle ${props.class ?? ""}`}
      style={{
        width: props.size ? `${props.size}px` : undefined,
        height: props.size ? `${props.size}px` : undefined,
        "--identity-color": identityLook(props.seed).color,
      }}
      data-component="identity-avatar"
      data-seed={props.seed}
      aria-hidden="true"
    >
      <img src={cachedUri(props.seed, pinsFor(props.seed))} alt="" draggable={false} class="size-full" />
    </span>
  )
}

const LAYOUT: Record<number, readonly Spot[]> = {
  2: [
    { x: 0, y: 0.02, s: 0.62, z: 0 },
    { x: 0.38, y: 0.36, s: 0.62, z: 1 },
  ],
  3: [
    { x: 0.14, y: 0.3, s: 0.72, z: 2 },
    { x: -0.04, y: 0.02, s: 0.58, z: 0 },
    { x: 0.46, y: 0.02, s: 0.58, z: 1 },
  ],
}

type Spot = { x: number; y: number; s: number; z: number }

const BODY = { cx: 0.553, cy: 0.5, rx: 0.39, ry: 0.25 }

function cutout(spots: readonly Spot[], index: number): Record<string, string> {
  const me = spots[index]!
  const holes = spots
    .filter((other) => other.z > me.z)
    .map((other) => {
      const cx = ((other.x + other.s * BODY.cx - me.x) / me.s) * 100
      const cy = ((other.y + other.s * BODY.cy - me.y) / me.s) * 100
      const rx = ((other.s * BODY.rx) / me.s) * 100
      const ry = ((other.s * BODY.ry) / me.s) * 100
      return `radial-gradient(calc(${rx}% + 2px) calc(${ry}% + 2px) at ${cx}% ${cy}%, transparent 99%, #000 100%)`
    })
  if (!holes.length) return {}
  const mask = holes.join(", ")
  return { "mask-image": mask, "-webkit-mask-image": mask, "mask-composite": "intersect", "-webkit-mask-composite": "source-in" }
}

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
