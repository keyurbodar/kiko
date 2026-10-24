import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, SearchIcon } from "@kiko/ui/icons"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { useLocation, useNavigate } from "@tanstack/solid-router"
import { createEffect, createSignal, For, on, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { cn } from "../lib/cn"
import { APP_VERSION } from "../lib/version-skew"
import { iconButtonClass, Page } from "./kit"
import { closeSettings } from "./open"
import { SETTINGS_GROUPS, searchSections, sectionAt, type SettingsSection } from "./sections"
import "./settings-dialog.css"

export function SettingsDialog(props: ParentProps) {
  const returnTo = document.activeElement
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const meta = () => sectionAt(pathname())
  const section = () => meta()?.id
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  const groups = () =>
    query().trim()
      ? [{ name: null, rows: rows() }]
      : SETTINGS_GROUPS.map((name) => ({ name, rows: rows().filter((s) => s.group === name) }))
  let body: HTMLDivElement | undefined
  const reveal = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-component="settings"] .settings-nav-row[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    )
  createEffect(
    on(section, () => {
      body?.scrollTo(0, 0)
      reveal()
    }),
  )
  onMount(() => {
    const narrow = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined
    narrow?.addEventListener("change", reveal)
    onCleanup(() => narrow?.removeEventListener("change", reveal))
  })
  const row = (s: SettingsSection) => (
    <button
      type="button"
      class="settings-nav-row"
      aria-current={s.id === section() ? "page" : undefined}
      data-section={s.id}
      onClick={() => void navigate({ to: s.to })}
    >
      <RemixIcon icon={s.icon} size={17} />
      <span class="settings-nav-label">{s.label}</span>
    </button>
  )

  return (
    <ModalV2 open preventScroll={false} onOpenChange={(open: boolean) => !open && closeSettings()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="settings-dialog"
          role="dialog"
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            const active = content.querySelector<HTMLElement>("[aria-current=page]") ?? content
            active.focus({ preventScroll: true })
            reveal()
          }}
          onCloseAutoFocus={(e: Event) => {
            if (!e.defaultPrevented && returnTo instanceof HTMLElement && returnTo.isConnected)
              returnTo.focus({ preventScroll: true })
          }}
        >
          <div data-component="settings">
            <nav class="settings-nav" data-component="settings-panel" aria-label="Settings sections">
              <ModalV2.Title class="settings-title">Settings</ModalV2.Title>
              <label class="settings-search">
                <RemixIcon icon={SearchIcon} size={15} />
                <input
                  type="search"
                  placeholder="Search settings"
                  aria-label="Search settings"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
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
                      <Show when={group.name && group.rows.length}>
                        <span class="settings-nav-heading">{group.name}</span>
                      </Show>
                      <For each={group.rows}>{row}</For>
                    </div>
                  )}
                </For>
              </Show>
              <span class="settings-nav-foot" data-field="app-version">
                Kiko {APP_VERSION}
              </span>
            </nav>
            <div
              ref={body}
              class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
              data-component="settings-body"
            >
              <div class="mx-auto w-full max-w-[764px] px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:pt-12">
                <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
                  {props.children}
                </Page>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              title="Close"
              class={cn(iconButtonClass, "absolute top-5 right-5")}
              data-action="close-dialog"
              onClick={closeSettings}
            >
              <RemixIcon icon={CloseIcon} class="size-3.5" />
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
