import { SearchField } from "@kiko/ui/v2/search-field"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@kiko/ui/icons"
import { glide } from "@kiko/ui/v2/glide"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { useLocation, useNavigate } from "@tanstack/solid-router"
import { createEffect, createSignal, For, on, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { cn } from "../lib/cn"
import { replay } from "../lib/motion"
import { APP_VERSION } from "../lib/version-skew"
import { connection, createDelayedStatus, type ConnectionView } from "../state/connection"
import { iconButtonClass, Page } from "./kit"
import { closeSettings } from "./open"
import { SETTINGS_GROUPS, searchSections, sectionAt, type SettingsSection } from "./sections"
import "./settings-dialog.css"

const LAYERS = '[role="dialog"], [role="menu"], [role="listbox"], [data-popper-positioner], .toast-v2'

type Health = "running" | "waiting" | "unreachable"

const HEALTH: Record<ConnectionView, Health> = {
  connected: "running",
  connecting: "waiting",
  reconnecting: "waiting",
  "app-behind": "waiting",
  "backend-behind": "waiting",
  disconnected: "unreachable",
  "signed-out": "unreachable",
}

const HEALTH_LABEL: Record<Health, string> = {
  running: "Kiko is running",
  waiting: "Reconnecting",
  unreachable: "Can't reach your Kiko",
}

function narrowQuery() {
  const query = typeof matchMedia === "function" ? matchMedia("(width < 768px)") : undefined
  const [narrow, setNarrow] = createSignal(query?.matches ?? false)
  const update = () => setNarrow(query?.matches ?? false)
  query?.addEventListener("change", update)
  onCleanup(() => query?.removeEventListener("change", update))
  return narrow
}

function StatusFoot() {
  const late = createDelayedStatus(() => {
    const health = HEALTH[connection.view()]
    return health === "running" ? null : health
  })
  const health = (): Health => late() ?? "running"
  return (
    <div class="settings-nav-foot" data-component="settings-status" data-health={health()}>
      <span class="settings-status-dot" aria-hidden="true" />
      <span
        class={cn("min-w-0 flex-1 truncate", health() === "waiting" && "motion-shine")}
        style={health() === "waiting" ? { "--run-text": "var(--fg4)", "--visible-animation-state": "running" } : {}}
        role="status"
      >
        {HEALTH_LABEL[health()]}
      </span>
      <span class="shrink-0 tabular-nums" data-field="app-version">
        {APP_VERSION}
      </span>
    </div>
  )
}

export function SettingsDialog(props: ParentProps) {
  const returnTo = document.activeElement
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const narrow = narrowQuery()
  const meta = () => sectionAt(pathname())
  const section = () => meta()?.id
  const [query, setQuery] = createSignal("")
  const rows = () => searchSections(query())
  const groups = () =>
    query().trim()
      ? [{ name: null, rows: rows() }]
      : SETTINGS_GROUPS.map((name) => ({ name, rows: rows().filter((s) => s.group === name) }))
  let body: HTMLDivElement | undefined
  let page: HTMLDivElement | undefined
  let nav!: HTMLElement
  let mark!: HTMLSpanElement
  const current = () => {
    const at =
      nav?.querySelector<HTMLElement>('.settings-nav-row[aria-current="page"]') ??
      nav?.querySelector<HTMLElement>(".settings-nav-row")
    if (at?.offsetParent) return at
    return page?.querySelector<HTMLElement>('[data-action="settings-back"]') ?? at
  }
  const reveal = () => requestAnimationFrame(() => current()?.scrollIntoView({ block: "nearest", inline: "nearest" }))
  createEffect(
    on(
      section,
      () => {
        body?.scrollTo(0, 0)
        replay(page)
        reveal()
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    if (!narrow() && pathname().replace(/\/$/, "") === "/settings")
      void navigate({ to: "/settings/models", replace: true })
  })
  const holdFocus = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof Element) || target.closest(LAYERS)) return
    current()?.focus({ preventScroll: true })
  }
  onMount(() => {
    document.addEventListener("focusin", holdFocus)
    onCleanup(() => document.removeEventListener("focusin", holdFocus))
    glide(nav, mark, {
      attributes: ["aria-current"],
      find: (host) => host.querySelector<HTMLElement>('.settings-nav-row[aria-current="page"]'),
    })
  })
  const row = (s: SettingsSection) => (
    <button
      type="button"
      class="settings-nav-row"
      aria-current={s.id === section() ? "page" : undefined}
      data-section={s.id}
      onClick={() => void navigate({ to: s.to })}
    >
      <RemixIcon icon={s.icon} size={16} />
      <span class="settings-nav-label">{s.label}</span>
      <RemixIcon icon={ChevronRightIcon} size={16} class="settings-nav-chevron" />
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
            ;(current() ?? (e.currentTarget as HTMLElement)).focus({ preventScroll: true })
            reveal()
          }}
          onCloseAutoFocus={(e: Event) => {
            if (!e.defaultPrevented && returnTo instanceof HTMLElement && returnTo.isConnected)
              returnTo.focus({ preventScroll: true })
          }}
        >
          <div data-component="settings" data-view={section() ? "page" : "list"}>
            <nav ref={nav} class="settings-nav" data-component="settings-panel" aria-label="Settings sections">
              <span ref={mark} class="settings-nav-glide" data-slot="glide" data-hidden="" aria-hidden="true" />
              <ModalV2.Title class="settings-title">Settings</ModalV2.Title>
              <SearchField
                wrapClass="settings-search"
                placeholder="Search settings"
                aria-label="Search settings"
                value={query()}
                onValue={setQuery}
              />
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
              <StatusFoot />
            </nav>
            <div
              ref={body}
              class="settings-body @container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
              data-component="settings-body"
            >
              <div
                ref={page}
                class="settings-page mx-auto w-full max-w-[764px] px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:pt-12"
              >
                <button
                  type="button"
                  class="settings-back group"
                  data-action="settings-back"
                  onClick={() => void navigate({ to: "/settings" })}
                >
                  <RemixIcon
                    icon={ChevronLeftIcon}
                    size={16}
                    class="transition-transform duration-(--dur-hover) group-hover:-translate-x-0.5 group-active:-translate-x-0.5"
                  />
                  Settings
                </button>
                <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
                  {props.children}
                </Page>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              title="Close"
              class={cn(iconButtonClass, "settings-close absolute top-5 right-5")}
              data-action="close-dialog"
              onClick={closeSettings}
            >
              <RemixIcon icon={CloseIcon} class="size-4" />
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
