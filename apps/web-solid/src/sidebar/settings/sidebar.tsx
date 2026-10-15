import { A } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { AppearanceIcon, BackIcon, ExtensionsIcon, type Glyph, ModelIcon, SearchIcon, SettingsIcon, SparklesIcon } from "@kiko/ui/icons"
import { SETTINGS_GROUPS, searchSections, type SettingsSection } from "../../settings/sections"

/*
 * The settings sidebar: back to chats, a search, and the sections under their group's label
 * (monocode's settings rail). While searching, the hits are one flat list. The URL names the
 * section, so the active row is the link the router marks.
 */

/** By section id. A section without an entry gets the gear. */
const ICON: Record<string, Glyph> = {
  models: ModelIcon,
  tools: ExtensionsIcon,
  recipes: SparklesIcon,
  appearance: AppearanceIcon,
  general: SettingsIcon,
}


export default function SettingsSidebar() {
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  const groups = () => (query().trim() ? [{ name: null, rows: rows() }] : SETTINGS_GROUPS.map((name) => ({ name, rows: rows().filter((s) => s.group === name) })))
  const row = (s: SettingsSection) => (
    <A href={`/settings/${s.id}`} class="settings-panel-row" activeClass="settings-panel-row-active" data-section={s.id}>
      <HugeIcon icon={ICON[s.id] ?? SettingsIcon} size={16} />
      <span class="settings-row-label">{s.label}</span>
    </A>
  )
  return (
    <nav class="settings-panel" data-component="settings-panel" aria-label="Settings sections">
      <A href="/chat" class="settings-panel-row" data-component="settings-back">
        <HugeIcon icon={BackIcon} size={16} />
        <span class="settings-row-label">Chats</span>
      </A>
      <label class="settings-search">
        <HugeIcon icon={SearchIcon} size={15} />
        <input
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query()) {
              e.stopPropagation()
              setQuery("")
            }
          }}
        />
      </label>
      <Show
        when={rows().length}
        fallback={
          <div class="flex flex-col items-center gap-2 py-6">
            <p class="settings-empty">Nothing matches</p>
          </div>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class="settings-group" data-group={group.name ?? "results"}>
              <For each={group.rows}>{row}</For>
            </div>
          )}
        </For>
      </Show>
    </nav>
  )
}
