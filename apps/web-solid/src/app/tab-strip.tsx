import { useLocation, useNavigate } from "@solidjs/router"
import { For, Show, createEffect, createMemo, untrack } from "solid-js"
import { infoOpen, loadInfoPanel, toggleInfo } from "../chat/info/state"
import { intentRef } from "../lib/intent"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { nextAfterClose, openTabs, stepTab } from "./open-tabs"

/*
 * The chat tab strip: kat's horizontal tabs in the top bar. Every size and
 * colour is a theme token (`--tab-*`). Nothing animates, so the active pill
 * moves with the route and the change is instant.
 *
 * The URL names the active tab. Opening a chat anywhere adds it here, closing
 * the active tab navigates to its neighbour, and `open-tabs.ts` persists the
 * list.
 */
const CHAT_PATH = /^\/chat\/([^/]+)$/

export function TabStrip() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeId = createMemo(() => {
    const match = CHAT_PATH.exec(location.pathname)
    const id = match ? decodeURIComponent(match[1]!) : null
    return id === "new" ? null : id
  })
  const strip: { el?: HTMLDivElement } = {}

  createEffect(() => {
    const id = activeId()
    if (id) untrack(() => openTabs.open(id))
  })

  const label = (id: string) => useApp.chatById(id)?.name ?? "chat"
  const unread = (id: string) => (useApp.chatById(id)?.unread ?? 0) > 0
  const go = (id: string | null) => navigate(id ? `/chat/${id}` : "/chat")

  const close = (id: string) => {
    const next = nextAfterClose(openTabs.ids(), id, activeId())
    openTabs.close(id)
    if (id === activeId()) go(next)
  }

  const focusTab = (id: string | null) => {
    if (id === null) return
    const el = strip.el?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
    el?.focus()
    el?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }

  const onKeyDown = (event: KeyboardEvent, id: string) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      const target = stepTab(openTabs.ids(), id, event.key === "ArrowRight" ? 1 : -1)
      go(target)
      queueMicrotask(() => focusTab(target))
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      const ids = openTabs.ids()
      const index = ids.indexOf(id)
      const rest = ids.filter((open) => open !== id)
      close(id)
      queueMicrotask(() => focusTab(rest[index] ?? rest[index - 1] ?? null))
    }
  }

  return (
    <div
      ref={(el) => (strip.el = el)}
      class="flex min-w-0 flex-1 items-center gap-[6px] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-component="tab-strip"
      role="tablist"
      aria-label="open chats"
    >
      <For each={openTabs.ids()}>
        {(id) => {
          const active = () => activeId() === id
          return (
            <div
              role="tab"
              tabindex={active() || (activeId() === null && openTabs.ids()[0] === id) ? 0 : -1}
              aria-selected={active()}
              ref={intentRef(() => void useApp.preloadChat(id))}
              data-component="tab"
              data-tab-id={id}
              data-active={active() ? "" : undefined}
              data-unread={unread(id) && !active() ? "" : undefined}
              class="group flex h-[var(--tab-h)] max-w-[var(--tab-max-w)] shrink-0 cursor-default items-center gap-[6px] rounded-[10px] bg-[var(--tab-bg)] py-0 pr-[6px] pl-[9px] text-[13px] font-medium text-[var(--tab-text)] outline-none select-none hover:bg-[var(--tab-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:scale-[.97] data-[active]:bg-[var(--tab-bg-active)] data-[active]:text-[var(--tab-text-active)] data-[active]:shadow-[var(--tab-shadow)]"
              onClick={() => go(id)}
              onAuxClick={(event) => {
                if (event.button === 1) close(id)
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault()
              }}
              onKeyDown={(event) => onKeyDown(event, id)}
            >
              {/* On the open chat, the avatar and the name are the way into its info panel. */}
              <span
                class="flex min-w-0 flex-1 items-center gap-[6px]"
                data-component="tab-identity"
                data-info-toggle={active() ? "" : undefined}
                aria-expanded={active() ? infoOpen() : undefined}
                title={active() ? "chat info" : undefined}
                onPointerEnter={() => active() && void loadInfoPanel()}
                onClick={(event) => {
                  if (!active()) return
                  event.stopPropagation()
                  toggleInfo()
                }}
              >
                <IdentityAvatar seed={id} size={16} />
                <span class="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)] group-data-[unread]:[-webkit-text-stroke:0.3px]">
                  {label(id)}
                </span>
              </span>
              <Show when={!active() && useApp.drafts()?.has(id)}>
                <span class="shrink-0 text-[10px] text-[var(--accent)]" data-component="tab-draft">
                  draft
                </span>
              </Show>
              <span class="flex size-4 shrink-0 items-center justify-center">
                <button
                  type="button"
                  tabindex="-1"
                  aria-label={`close ${label(id)}`}
                  data-component="tab-close"
                  class="hidden size-4 items-center justify-center rounded-full text-[var(--tab-text-active)] hover:bg-[var(--tab-bg-hover)] group-hover:flex group-data-[active]:flex"
                  onClick={(event) => {
                    event.stopPropagation()
                    close(id)
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                    <path d="M1 1l6 6M7 1L1 7" />
                  </svg>
                </button>
                <span
                  class="hidden size-[6px] rounded-full bg-[var(--accent)] group-data-[unread]:block group-hover:hidden"
                  data-component="tab-unread-dot"
                  aria-hidden="true"
                />
              </span>
            </div>
          )
        }}
      </For>
    </div>
  )
}
