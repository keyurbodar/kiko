import { useNavigate } from "@solidjs/router"
import { Moment } from "../mascot/pixel/lazy"
import { Icon } from "@kiko/ui/v2/icon"
import { type ChatSearchPage, type RoomId, snippetParts } from "@kiko/protocol"
import { For, Show, Suspense, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { dividerLabel } from "../chat/lib/time-label"
import { useApp } from "../lib/store"
import { createSearch, type Hit, type HitPage, type SearchView, senderName } from "./model"
import { closeSearch, requestJump, type SearchScope, searchScope, setSearchScope } from "./state"
import "./search.css"

/*
 * Message search, as kat has it (⌘F, ⌘⇧F): a rounded bar at the top of the chat panel with the
 * query and a chat / all toggle, results under it, the transcript dimmed behind. Arrow keys move,
 * enter jumps to the message (opening its chat first), escape closes. Nothing animates.
 *
 * "chat" asks the open room over its socket. "all" asks the Worker, which searches the user's most
 * recently active chats (room/search-route.ts on the server).
 */

async function searchAll(query: string, before?: number): Promise<HitPage | null> {
  const params = new URLSearchParams({ q: query })
  if (before !== undefined) params.set("before", String(before))
  try {
    const res = await fetch(`/api/search?${params}`, { credentials: "same-origin" })
    return res.ok ? ((await res.json()) as ChatSearchPage) : null
  } catch {
    return null
  }
}

async function searchChat(query: string, before?: number): Promise<HitPage | null> {
  const roomId = useApp.activeThreadId() as RoomId | null
  if (!roomId) return { results: [], next: null }
  const page = await useApp.searchRoom(query, before)
  return page && { results: page.results.map((hit) => ({ ...hit, roomId })), next: page.next }
}

export default function SearchOverlay() {
  const navigate = useNavigate()
  const [view, setView] = createSignal<SearchView>()
  const hasChat = () => !!useApp.activeThreadId()
  const search = createSearch({
    scope: searchScope() === "chat" && hasChat() ? "chat" : "all",
    fetch: (scope, query, before) => (scope === "chat" ? searchChat(query, before) : searchAll(query, before)),
    onChange: setView,
  })
  setView(search.view())
  onCleanup(search.dispose)

  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  // Focus goes back where it was when the overlay closes without a jump.
  const before = document.activeElement
  onMount(() => input?.focus())
  // ⌘F or ⌘⇧F while open switches the scope and puts the cursor back in the field.
  createEffect(
    on(searchScope, (scope) => {
      if (!scope) return
      search.setScope(scope === "chat" && !hasChat() ? "all" : scope)
      input?.focus()
      input?.select()
    }),
  )
  const close = () => {
    closeSearch()
    if (before instanceof HTMLElement && before.isConnected) before.focus()
  }
  const choose = (hit: Hit | undefined) => {
    if (!hit) return
    closeSearch()
    requestJump({ roomId: hit.roomId, id: hit.id, seq: hit.seq })
    if (hit.roomId !== useApp.activeThreadId()) navigate(`/chat/${hit.roomId}`)
  }
  const pickScope = (scope: SearchScope) => {
    setSearchScope(scope)
    input?.focus()
  }
  // The selected row stays in view as the arrows move it.
  createEffect(
    on(
      () => view()?.selected,
      (i) => list?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" }),
    ),
  )
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      search.move(e.key === "ArrowDown" ? 1 : -1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const v = search.view()
      choose(v.hits[v.selected])
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  const chatName = (roomId: string) => useApp.chat(roomId)?.title ?? "Chat"
  const now = Date.now()

  return (
    <div class="search-overlay" data-component="search-overlay" data-scope={view()?.scope}>
      <div class="search-scrim" aria-hidden="true" onPointerDown={close} />
      <div class="search-panel" role="dialog" aria-label="Search messages">
        <div class="search-bar">
          <Icon name="magnifying-glass" size="small" class="search-glass" />
          <input
            ref={input}
            class="search-input"
            data-component="search-input"
            placeholder="Search messages…"
            aria-label="Search messages"
            aria-controls="search-results"
            aria-activedescendant={view()?.hits.length ? `search-hit-${view()!.selected}` : undefined}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => search.type(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <div class="search-scope" role="radiogroup" aria-label="Search in">
            <For each={["chat", "all"] as const}>
              {(scope) => (
                <button
                  type="button"
                  role="radio"
                  class="search-scope-option"
                  data-component={`search-scope-${scope}`}
                  aria-checked={view()?.scope === scope}
                  disabled={scope === "chat" && !hasChat()}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pickScope(scope)}
                >
                  {scope === "chat" ? "Chat" : "All"}
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={view()?.query.trim()}>
          <div
            ref={list}
            id="search-results"
            class="search-results"
            role="listbox"
            data-component="search-results"
            data-status={view()?.status}
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) void search.more()
            }}
          >
            <For each={view()?.hits}>
              {(hit, i) => (
                <div
                  id={`search-hit-${i()}`}
                  class="search-hit"
                  role="option"
                  data-component="search-hit"
                  data-index={i()}
                  data-message-id={hit.id}
                  aria-selected={view()?.selected === i()}
                  onPointerMove={() => search.select(i())}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(hit)}
                >
                  <div class="search-hit-head">
                    <span class="search-hit-from">{senderName(hit.from, useApp.agents())}</span>
                    <Show when={view()?.scope === "all"}>
                      <span class="search-hit-chat" data-component="search-hit-chat">{chatName(hit.roomId)}</span>
                    </Show>
                    <span class="search-hit-time">{dividerLabel(hit.at, now)}</span>
                  </div>
                  <div class="search-hit-snippet">
                    <For each={snippetParts(hit.snippet)}>{(part) => (part.match ? <mark>{part.text}</mark> : part.text)}</For>
                  </div>
                </div>
              )}
            </For>
            <Show when={!view()?.hits.length}>
              <div class="search-empty" data-component="search-empty">
                <Show when={view()?.status === "done"}>
                  <Suspense>
                    <Moment kind="nothing" />
                  </Suspense>
                </Show>
                {view()?.status === "error" ? "Search is not reachable" : view()?.status === "done" ? "No messages found" : "Searching…"}
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
