import { A } from "@solidjs/router"
import { Moment } from "../../mascot/pixel/lazy"
import { createSignal, For, Suspense } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { AppearanceIcon, BackIcon, ExtensionsIcon, type Glyph, IntegrationsIcon, ModelIcon, SearchIcon, SettingsIcon, SkillsIcon, UserIcon } from "@kiko/ui/icons"
import { searchSections } from "../../settings/sections"

/*
 * The settings sidebar: back to chats, a search, and one row per section. You and the account
 * page are the card at the sidebar's foot. The URL names the section, so the active row is the
 * link the router marks.
 */

/** By section id. A section without an entry gets the gear. */
const ICON: Record<string, Glyph> = {
  models: ModelIcon,
  integrations: IntegrationsIcon,
  extensions: ExtensionsIcon,
  skills: SkillsIcon,
  appearance: AppearanceIcon,
  account: UserIcon,
}

export default function SettingsSidebar() {
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  return (
    <nav class="settings-panel" data-component="settings-panel" aria-label="settings sections">
      <A href="/chat" class="settings-panel-row" data-component="settings-back">
        <HugeIcon icon={BackIcon} size={16} />
        <span class="settings-row-label">chats</span>
      </A>
      <label class="settings-search">
        <HugeIcon icon={SearchIcon} size={15} />
        <input
          type="search"
          placeholder="search settings"
          aria-label="search settings"
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
      <For
        each={rows()}
        fallback={
          <div class="flex flex-col items-center gap-2 py-6">
            <Suspense>
              <Moment kind="nothing" />
            </Suspense>
            <p class="settings-empty">nothing matches</p>
          </div>
        }
      >
        {(s) => (
          <A href={`/settings/${s.id}`} class="settings-panel-row" activeClass="settings-panel-row-active" data-section={s.id}>
            <HugeIcon icon={ICON[s.id] ?? SettingsIcon} size={16} />
            <span class="settings-row-label">{s.label}</span>
          </A>
        )}
      </For>
    </nav>
  )
}
