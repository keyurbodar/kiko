import { cachedUri } from "@kiko/avatar/uri"
import { For, Show } from "solid-js"
import { KikoMark } from "../../lib/brand"

export const TEAM = ["Kiko", "Alpha", "Beta", "Gamma"] as const

export function Perch(props: { awake: number; celebrating: boolean }) {
  return (
    <div class="ob-perch" aria-hidden="true" data-celebrating={props.celebrating ? "" : undefined}>
      <For each={TEAM}>
        {(name, i) => (
          <span
            class="ob-mascot"
            data-awake={i() < props.awake ? "" : undefined}
            data-newest={i() === props.awake - 1 ? "" : undefined}
            style={{ "--i": i() }}
          >
            <Show when={name !== "Kiko"} fallback={<KikoMark class="ob-mark" size={62} />}>
              <img src={cachedUri(name, {})} alt="" width="74" height="74" draggable={false} />
            </Show>
            <b class="ob-z" style={{ "--z": `${0.35 * (i() + 1)}s` }}>
              z
            </b>
          </span>
        )}
      </For>
    </div>
  )
}
