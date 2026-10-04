import { A } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { session } from "../../app/session"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { SECTION_ICON, searchSections } from "../../settings/sections"
import { useApp } from "../../lib/store"

/*
 * The settings sidebar, laid out like kat's: a search, the signed-in user's card (which opens
 * the account page, where sign out lives), and one row per section with an icon and a hint
 * line. The URL names the section, so the active row is the link the router marks.
 */

function Icon(props: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={props.path} />
    </svg>
  )
}

export default function SettingsSidebar() {
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <nav class="settings-panel" data-component="settings-panel" aria-label="settings sections">
      <label class="settings-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.75" />
          <path d="M10.5 10.5L14 14" />
        </svg>
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
      <Show when={!query()}>
        <A href="/settings/account" class="settings-user" activeClass="settings-user-active" data-component="settings-user" aria-label="account">
          <IdentityAvatar seed={user()?.id ?? "you"} size={32} />
          <span class="min-w-0 flex-1">
            <span class="settings-user-name">{(user()?.name ?? "you").toLowerCase()}</span>
            <span class="settings-user-sub">{(user()?.email ?? "").toLowerCase()}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4.5 2.5L8 6l-3.5 3.5" />
          </svg>
        </A>
      </Show>
      <For each={rows()} fallback={<p class="settings-empty">nothing matches</p>}>
        {(s) => (
          <A href={`/settings/${s.id}`} class="settings-panel-row" activeClass="settings-panel-row-active" data-section={s.id}>
            <span class="settings-row-icon">
              <Icon path={SECTION_ICON[s.id]} />
            </span>
            <span class="settings-row-label">{s.label}</span>
            {/* Installs that wait for the human: a count, so an agent's proposal is never missed. */}
            <Show when={s.id === "extensions" && (useApp.user()?.proposals().length ?? 0) > 0}>
              <span class="ml-auto min-w-5 rounded-full bg-[var(--accent-fill)] px-1.5 text-center text-[11px] leading-5 text-[var(--on-accent)]" data-component="proposals-count">
                {useApp.user()?.proposals().length}
              </span>
            </Show>
          </A>
        )}
      </For>
    </nav>
  )
}
