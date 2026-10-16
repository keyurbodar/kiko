import { createSignal } from "solid-js"
import type { Hit } from "../search/model"
import type { Command } from "./registry"

/*
 * The palette's message search, as t3code's "Search project contents": a view that asks for what is
 * typed after a short pause and lists the hits under their chat. It shares the overlay's debounce,
 * stale-answer and paging logic. Opening the palette never waits on it; only this view asks the Worker.
 * The engine is a lazy module: it loads when this view first lists or hears a query.
 */
type Engine = (typeof import("./message-search-engine"))["searchEngine"]
const [engine, setEngine] = createSignal<Engine>()
let loading: Promise<Engine> | undefined
const load = () => (loading ??= import("./message-search-engine").then((m) => (setEngine(() => m.searchEngine), m.searchEngine)))

export const preloadMessageSearch = () => void load()

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
    search: () => {
      const e = engine()
      if (!e) {
        void load()
        return []
      }
      return e.choices(deps.open)
    },
    onQuery: (query) => void load().then((e) => e.type(query)),
    state: () => {
      const status = engine()?.status()
      return status === "loading" || status === "error" ? status : undefined
    },
    run: () => deps.openView("chats.search-all"),
  }
}
