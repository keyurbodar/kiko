import { RemixIcon } from "@kiko/ui/remix-icon"
import { AppearanceIcon, CloseIcon, CommandIcon, ExtensionsIcon, type Glyph, ModelIcon, SearchIcon, SettingsIcon, UserIcon } from "@kiko/ui/icons"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays"
import { createEffect, createSignal, For, lazy, on, onCleanup, Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { cn } from "../lib/cn"
import Appearance from "../theme/appearance"
import { Account } from "./account"
import { closeSettings, openSettings, settingsSection } from "./dialog-state"
import Initiative from "./initiative"
import { iconButtonClass, Page } from "./kit"
import { ModelsPage } from "./models"
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, searchSections, type SettingsSection } from "./sections"
import Tools from "./tools"
import "./settings-dialog.css"

/*
 * Settings, as a dialog over the chat: a search and the sections under their group on the left
 * (monocode's settings rail), the open section's page on the right. While searching, the hits are one
 * flat list. Every section ships in this chunk, so moving between them never waits on the network.
 */

// The shortcut page carries the hotkey library, which the shell already loads lazily, so it is its own
// chunk. It starts loading with this one, so opening the section never waits on the network.
const KeyboardPage = lazy(() => import("./keyboard"))
void KeyboardPage.preload()

// A `/settings` link can open the dialog before the idle preload has fetched Kobalte, and ModalV2 draws
// nothing until it has.
void loadOverlaysV2()

const PAGES: Record<SettingsSection["id"], () => JSX.Element> = { models: ModelsPage, tools: Tools, appearance: Appearance, general: Initiative, keyboard: KeyboardPage, account: Account }

const ICON: Record<SettingsSection["id"], Glyph> = {
  models: ModelIcon,
  tools: ExtensionsIcon,
  appearance: AppearanceIcon,
  general: SettingsIcon,
  keyboard: CommandIcon,
  account: UserIcon,
}

export default function SettingsDialog() {
  // Kobalte hands focus back to a dialog's trigger, and this one has none, so it keeps where focus was.
  const returnTo = document.activeElement
  const section = () => settingsSection() ?? "models"
  const meta = () => SETTINGS_SECTIONS.find((s) => s.id === section())
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  const groups = () => (query().trim() ? [{ name: null, rows: rows() }] : SETTINGS_GROUPS.map((name) => ({ name, rows: rows().filter((s) => s.group === name) })))
  let body: HTMLDivElement | undefined
  createEffect(on(section, () => body?.scrollTo(0, 0), { defer: true }))
  // Signing out unmounts the shell with the dialog in it. The next sign-in starts with it closed.
  onCleanup(closeSettings)

  const row = (s: SettingsSection) => (
    <button type="button" class="settings-nav-row" aria-current={s.id === section() ? "page" : undefined} data-section={s.id} onClick={() => openSettings(s.id)}>
      <RemixIcon icon={ICON[s.id]} size={16} />
      <span class="settings-nav-label">{s.label}</span>
    </button>
  )

  return (
    // No scroll lock: the model picker and the select open their lists in a portal outside the dialog, and
    // the lock would swallow their wheel. Nothing under the dialog scrolls the page anyway.
    <ModalV2 open preventScroll={false} onOpenChange={(open: boolean) => !open && closeSettings()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="settings-dialog"
          onOpenAutoFocus={(e: Event) => {
            // The open section's row rather than the search, so a touch screen does not raise its keyboard.
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            ;(content.querySelector<HTMLElement>("[aria-current=page]") ?? content).focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(e: Event) => {
            if (!e.defaultPrevented && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true })
          }}
        >
          <div data-component="settings">
            <nav class="settings-nav" data-component="settings-panel" aria-label="Settings sections">
              <ModalV2.Title class="px-2 pb-3 font-display text-[20px] font-bold leading-snug tracking-[-0.015em] text-foreground">Settings</ModalV2.Title>
              <label class="settings-search">
                <RemixIcon icon={SearchIcon} size={15} />
                <input
                  type="search"
                  placeholder="Search settings"
                  aria-label="Search settings"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    // Escape empties the search first. Kobalte closes the dialog only on an Escape nobody took.
                    if (e.key !== "Escape" || !query()) return
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery("")
                  }}
                />
              </label>
              <Show when={rows().length} fallback={<p class="settings-nav-empty">Nothing matches</p>}>
                <For each={groups()}>
                  {(group) => (
                    <div class="settings-nav-group" data-group={group.name ?? "results"}>
                      <For each={group.rows}>{row}</For>
                    </div>
                  )}
                </For>
              </Show>
            </nav>
            <div ref={body} class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
              <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
                <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
                  <Dynamic component={PAGES[section()]} />
                </Page>
              </div>
            </div>
            <button type="button" aria-label="Close" title="Close" class={cn(iconButtonClass, "absolute top-4 right-4")} data-action="close-dialog" onClick={closeSettings}>
              <RemixIcon icon={CloseIcon} class="size-3.5" />
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
