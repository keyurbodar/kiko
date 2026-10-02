import { A } from "@solidjs/router"
import { For } from "solid-js"
import { SETTINGS_SECTIONS } from "../../settings/sections"

/*
 * The settings sidebar: the section list. The URL names the section, so the active row is the
 * link the router marks, and a reload lands where the user was.
 */
export default function SettingsSidebar() {
  return (
    <nav class="settings-panel" data-component="settings-panel" aria-label="settings sections">
      <For each={SETTINGS_SECTIONS}>
        {(s) => (
          <A href={`/settings/${s.id}`} class="settings-panel-row" activeClass="settings-panel-row-active" data-section={s.id}>
            {s.label}
          </A>
        )}
      </For>
    </nav>
  )
}
