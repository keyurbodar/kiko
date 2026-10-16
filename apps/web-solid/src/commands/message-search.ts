import { createRoot, createSignal } from "solid-js"
import type { Hit } from "../search/model"
import { createSearch, senderName, type SearchView } from "../search/model"
import { fetchHits } from "../search/fetch"
import { useApp } from "../lib/store"
import type { Choice, Command } from "./registry"

/*
 * The palette's message search, as t3code's "Search project contents": a view that asks for what is
 * typed after a short pause and lists the hits under their chat. It shares the overlay's debounce,
 * stale-answer and paging logic. Opening the palette never waits on it; only this view asks the Worker.
 */
const search = createRoot(() => {
  const [view, setView] = createSignal<SearchView>()
  const s = createSearch({ scope: "all", fetch: fetchHits, onChange: setView })
  setView(s.view())
  return { ...s, view }
})

const choice = (hit: Hit, open: (hit: Hit) => void): Choice => ({
  id: `${hit.roomId}:${hit.id}`,
  title: `${senderName(hit.from, useApp.agents())} in ${useApp.chat(hit.roomId)?.title ?? "Chat"}`,
  snippet: hit.snippet,
  icon: "chat",
  run: () => open(hit),
})

export function messageSearchCommand(deps: { open: (hit: Hit) => void; openView: (id: string) => void }): Command {
  return {
    id: "chats.search-all",
    title: "Search messages…",
    group: "chats",
    icon: "search",
    shortcut: "Mod+Shift+F",
    global: true,
    placeholder: "Search messages…",
    enter: "Open message",
    empty: { none: "Type to search every chat", noMatch: "No messages found" },
    search: () => (search.view()?.hits ?? []).map((hit) => choice(hit, deps.open)),
    onQuery: (query) => search.type(query),
    state: () => {
      const status = search.view()?.status
      return status === "loading" || status === "error" ? status : undefined
    },
    run: () => deps.openView("chats.search-all"),
  }
}
