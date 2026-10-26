import { cachedUri } from "@kiko/avatar/uri"
import { For, Show } from "solid-js"
import { TEAM } from "./mascots"

export function Backdrop(props: { awake: number; signedIn: boolean }) {
  return (
    <div class="ob-backdrop" aria-hidden="true">
      <div class="ob-back-side">
        <div class="ob-back-rows">
          <For each={TEAM}>
            {(name, i) => (
              <div class="ob-back-row" data-on={i() < props.awake ? "" : undefined}>
                <img src={cachedUri(name, {})} alt="" width="32" height="32" />
                <span>
                  <i />
                  <i />
                </span>
              </div>
            )}
          </For>
        </div>
        <Show when={props.signedIn}>
          <div class="ob-back-me">
            <span />
            <i />
          </div>
        </Show>
      </div>
      <div class="ob-back-main">
        <div class="ob-back-composer" />
      </div>
    </div>
  )
}
