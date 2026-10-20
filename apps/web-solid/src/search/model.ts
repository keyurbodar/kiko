import type { Agent, RoomId, SearchHit, Sender } from "@kiko/protocol"
import { agentDisplayName } from "../lib/names"
import type { SearchScope } from "./state"

export type Hit = SearchHit & { roomId: RoomId }
export type HitPage = { results: readonly Hit[]; next: number | null }

export type SearchStatus = "idle" | "loading" | "done" | "error"

export type SearchView = {
  query: string
  scope: SearchScope
  hits: readonly Hit[]
  next: number | null
  status: SearchStatus
  selected: number
}

export const SEARCH_DEBOUNCE_MS = 120
export const PAGE_AHEAD = 5

export type Timer = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
const realTimer: Timer = { set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }

export function createSearch(options: {
  scope: SearchScope
  fetch(scope: SearchScope, query: string, before?: number): Promise<HitPage | null>
  onChange(view: SearchView): void
  delayMs?: number
  timer?: Timer
}) {
  const timer = options.timer ?? realTimer
  const delay = options.delayMs ?? SEARCH_DEBOUNCE_MS
  let view: SearchView = { query: "", scope: options.scope, hits: [], next: null, status: "idle", selected: 0 }
  let pending: unknown
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
    type(query: string) {
      if (query === view.query) return
      set({ query })
      ask(false)
    },
    setScope(scope: SearchScope) {
      if (scope === view.scope) return
      set({ scope, hits: [], next: null, selected: 0 })
      ask(true)
    },
    more,
    rerun() {
      ask(true)
    },
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

export function senderName(from: Sender, agents: readonly Pick<Agent, "slug" | "name">[]): string {
  if (from.kind === "human") return "You"
  if (from.kind === "system") return "Kiko"
  return agentDisplayName(from.slug, agents)
}
