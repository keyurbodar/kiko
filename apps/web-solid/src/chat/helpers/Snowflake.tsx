import { createMemo, For, Show } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import type { HelperState } from "./helper-model"
import { flake } from "./snowflake"
import "./helpers.css"

const ARMS = [0, 60, 120, 180, 240, 300]

export function Snowflake(props: {
  seed: string
  size?: number
  state?: HelperState
  parent?: string
  disc?: boolean
}) {
  const size = () => props.size ?? 18
  const look = createMemo(() => flake(props.seed))
  const state = () => props.state ?? "done"
  return (
    <span
      class="helper-flake"
      data-component="helper-flake"
      data-state={state()}
      data-disc={props.disc ? "" : undefined}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      aria-hidden="true"
    >
      <svg viewBox="-12 -12 24 24" class="helper-flake-art" fill="none" stroke="currentColor" stroke-linecap="round">
        <g class="helper-flake-spin" stroke-width="1.5" stroke-linejoin="round">
          <For each={ARMS}>{(angle) => <path d={look().arm} transform={`rotate(${angle})`} />}</For>
          <Show when={look().hub > 0}>
            <circle r={look().hub} fill="currentColor" stroke="none" />
          </Show>
        </g>
      </svg>
      <Show when={props.parent}>
        {(slug) => (
          <span class="helper-flake-parent" data-component="helper-parent">
            <IdentityAvatar seed={slug()} size={Math.max(10, Math.round(size() * 0.46))} />
          </span>
        )}
      </Show>
    </span>
  )
}
