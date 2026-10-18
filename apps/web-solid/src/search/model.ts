import type { Agent, RoomId, SearchHit, Sender } from "@kiko/protocol"
import { agentDisplayName } from "../lib/names"
import type { SearchScope } from "./state"

/*
 * The overlay's logic, without a DOM: the debounced query, stale answers dropped, paging, and the
 * selection. The overlay renders `SearchView` and calls these; the tests drive them with a fake timer.
 */

export type Hit = SearchHit & { roomId: RoomId }
export type HitPage = { results: readonly Hit[]; next: number | null }

export type SearchStatus = "idle" | "loading" | "done" | "error"

export type SearchView = {
  query: string
  scope: SearchScope
  hits: readonly Hit[]
  /** The cursor for the next page, or null at the end. */
  next: number | null
  status: SearchStatus
  /** The highlighted row. */
  selected: number
}

/** Typing waits this long for the next key before it asks. */
export const SEARCH_DEBOUNCE_MS = 120
/** The next page is asked for when the selection comes this close to the end. */
export const PAGE_AHEAD = 5

export type Timer = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
const realTimer: Timer = { set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export function createSearch(options: {
  scope: SearchScope
  /** One page for a query, newest first. `before` is the previous page's `next`. Null when it failed. */
  fetch(scope: SearchScope, query: string, before?: number): Promise<HitPage | null>
  onChange(view: SearchView): void
  delayMs?: number
  timer?: Timer
}) {
  const timer = options.timer ?? realTimer
  const delay = options.delayMs ?? SEARCH_DEBOUNCE_MS
  let view: SearchView = { query: "", scope: options.scope, hits: [], next: null, status: "idle", selected: 0 }
  let pending: unknown
  /** Bumped on every new question, so an answer to an older one is dropped. */
  let generation = 0
  let paging = false

  const set = (patch: Partial<SearchView>) => {
    view = { ...view, ...patch }
    options.onChange(view)
  }

  async function run() {
    pending = undefined
    const gen = ++generation
    paging = false
    const { scope, query } = view
    const page = await options.fetch(scope, query.trim())
    if (gen !== generation) return
    if (!page) return set({ status: "error" })
    set({ hits: [...page.results], next: page.next, status: "done", selected: 0 })
  }

  function ask(now: boolean) {
    if (pending !== undefined) timer.clear(pending)
    pending = undefined
    if (!view.query.trim()) {
      generation++
      return set({ hits: [], next: null, status: "idle", selected: 0 })
    }
    // The last results stay on screen while the next ones load, so typing never blanks the list.
    set({ status: "loading" })
    if (now) void run()
    else pending = timer.set(() => void run(), delay)
  }

  async function more() {
    if (paging || view.next === null || view.status !== "done") return
    paging = true
    const gen = generation
    const page = await options.fetch(view.scope, view.query.trim(), view.next)
    if (gen !== generation) return
    paging = false
    if (!page) return
    const seen = new Set(view.hits.map((h) => `${h.roomId}:${h.id}`))
    set({ hits: [...view.hits, ...page.results.filter((h) => !seen.has(`${h.roomId}:${h.id}`))], next: page.next })
  }

  return {
    view: () => view,
    /** The query changed: ask after a pause in typing. */
    type(query: string) {
      if (query === view.query) return
      set({ query })
      ask(false)
    },
    /** A new scope asks at once: the toggle is a click, not typing. */
    setScope(scope: SearchScope) {
      if (scope === view.scope) return
      set({ scope, hits: [], next: null, selected: 0 })
      ask(true)
    },
    more,
    /** Ask the same query again, for a chat that changed under the results. */
    rerun() {
      ask(true)
    },
    /** Moves the selection, clamped to the list. Nearing the end asks for the next page. */
    move(delta: number) {
      const count = view.hits.length
      if (!count) return
      const selected = Math.max(0, Math.min(count - 1, view.selected + delta))
      if (selected !== view.selected) set({ selected })
      if (selected >= count - PAGE_AHEAD) void more()
    },
    select(index: number) {
      if (index >= 0 && index < view.hits.length && index !== view.selected) set({ selected: index })
    },
    dispose() {
      if (pending !== undefined) timer.clear(pending)
      generation++
    },
  }
}

/** Who wrote a hit, as a row names them. */
export function senderName(from: Sender, agents: readonly Pick<Agent, "slug" | "name">[]): string {
  if (from.kind === "human") return "You"
  if (from.kind === "system") return "Kiko"
  return agentDisplayName(from.slug, agents)
}
