import { useLocation, useNavigate } from "@solidjs/router"
import { For, createEffect, createMemo, onCleanup, onMount, untrack } from "solid-js"
import { infoOpen, loadInfoPanel, toggleInfo } from "../chat/info/state"
import { intentRef } from "../lib/intent"
import { ChatAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { closeChat } from "../sidebar/actions"
import { openTabs, stepTab } from "./open-tabs"
import "./tab-strip.css"

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
    return match ? decodeURIComponent(match[1]!) : null
  })
  const strip: { el?: HTMLDivElement } = {}

  createEffect(() => {
    const id = activeId()
    if (id) untrack(() => openTabs.open(id))
  })

  // A new or switched-to tab can sit past the strip's edge, most often on a phone. Bring it into view.
  createEffect(() => {
    const id = activeId()
    openTabs.ids()
    if (!id) return
    queueMicrotask(() => {
      strip.el?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" })
    })
  })

  const label = (id: string) => useApp.chatById(id)?.name || "chat"
  const unread = (id: string) => (useApp.chatById(id)?.unread ?? 0) > 0
  const go = (id: string | null) => navigate(id ? `/chat/${id}` : "/chat")

  // One close for every way of closing a tab: it also deletes a temporary chat.
  const close = (id: string) => closeChat(id, activeId(), navigate)

  const focusTab = (id: string | null) => {
    if (id === null) return
    const el = strip.el?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
    el?.focus()
    el?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }

  /*
   * Overflow fades. The strip scrolls sideways with no scrollbar; each edge fades
   * only while there is more to scroll that way, so the first tab is never dimmed.
   */
  const edges = () => {
    const el = strip.el
    if (!el) return
    el.toggleAttribute("data-fade-start", el.scrollLeft > 1)
    el.toggleAttribute("data-fade-end", el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }
  createEffect(() => {
    openTabs.ids()
    queueMicrotask(edges)
  })
  onMount(() => {
    if (!strip.el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(edges)
    observer.observe(strip.el)
    onCleanup(() => observer.disconnect())
  })
  // A vertical wheel scrolls the strip sideways, as a trackpad's sideways swipe already does.
  const onWheel = (event: WheelEvent) => {
    const el = strip.el
    if (!el || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || el.scrollWidth <= el.clientWidth) return
    event.preventDefault()
    el.scrollLeft += event.deltaY
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
      class="tab-strip flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
      data-component="tab-strip"
      role="tablist"
      aria-label="open chats"
      onScroll={edges}
      onWheel={onWheel}
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
              class="group flex h-[var(--tab-h)] max-w-[var(--tab-max-w)] shrink-0 cursor-default items-center gap-1.5 rounded-[9px] pr-1 pl-2.5 text-[13px] font-medium text-[var(--tab-text)] outline-none select-none hover:text-[var(--tab-text-active)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] data-[active]:bg-[var(--tab-bg-active)] data-[active]:text-[var(--tab-text-active)]"
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
                {/* One 16 px box for every icon, so a group's stacked faces and a single bird line up. */}
                <span class="flex size-4 shrink-0 items-center justify-center" data-component="tab-icon">
                  <ChatAvatar faces={useApp.chatFaces(id)} size={16} />
                </span>
                {/* The title fades out at its max width instead of ending in an ellipsis. The fade sits on 16 px of padding, so a title that fits is never dimmed. */}
                <span class="min-w-0 flex-1 overflow-hidden pr-4 leading-[var(--tab-h)] whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)] group-data-[unread]:text-[var(--tab-text-active)]">
                  {label(id)}
                </span>
              </span>
              <span class="flex size-4 shrink-0 items-center justify-center">
                <button
                  type="button"
                  tabindex="-1"
                  aria-label={`close ${label(id)}`}
                  data-component="tab-close"
                  class="relative hidden size-4 items-center justify-center rounded-[5px] text-[var(--tab-text)] before:absolute before:-inset-[10px] before:content-[''] before:md:-inset-1 hover:bg-[var(--tab-bg-hover)] hover:text-[var(--tab-text-active)] group-hover:flex group-data-[active]:flex"
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
