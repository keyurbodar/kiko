import type { LifeLine, MemoryModel, MemoryOp, MemoryResult } from "@kiko/protocol"
import { createStore, produce } from "solid-js/store"
import type { MemoryClient } from "./client"

export type MemoryState = {
  loaded: boolean
  error: string | null
  lines: LifeLine[]
  next: number | null
  view: string[]
  opened: Record<string, string[]>
  results: LifeLine[] | null
  model: MemoryModel
}

export type MemoryStore = ReturnType<typeof createMemoryStore>

const PAGE = 50
const SEARCH_MS = 200

const mergeHead = (head: readonly LifeLine[], current: readonly LifeLine[]): LifeLine[] => {
  const seen = new Set(head.map((l) => l.pos))
  return [...head, ...current.filter((l) => l.pos >= 0 && !seen.has(l.pos))]
}

export function createMemoryStore(client: MemoryClient, now: () => number = Date.now) {
  const [state, setState] = createStore<MemoryState>({
    loaded: false,
    error: null,
    lines: [],
    next: null,
    view: [],
    opened: {},
    results: null,
    model: null,
  })
  let searchSeq = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const ask = async (op: MemoryOp): Promise<MemoryResult | null> => {
    const result = await client.request(op)
    if (result.ok) return result
    setState("error", result.error)
    return null
  }
  const patch = (pos: number, change: Partial<LifeLine>) =>
    setState(
      "lines",
      (l) => l.pos === pos,
      produce((l) => Object.assign(l, change)),
    )

  async function load() {
    const wasLoaded = state.loaded
    const [list, view, model] = await Promise.all([
      ask({ op: "list", limit: PAGE }),
      ask({ op: "view" }),
      ask({ op: "model" }),
    ])
    setState("loaded", true)
    if (list && "lines" in list) {
      if (wasLoaded) setState("lines", (current) => mergeHead(list.lines, current))
      else setState({ lines: [...list.lines], next: list.lines.length < PAGE ? null : list.next })
    }
    if (view && "text" in view) setState("view", [...view.text])
    if (model && "model" in model) setState("model", model.model)
  }

  async function refreshHead() {
    const list = await ask({ op: "list", limit: PAGE })
    if (list && "lines" in list) setState("lines", (current) => mergeHead(list.lines, current))
  }

  async function more() {
    if (state.next === null) return
    const list = await ask({ op: "list", before: state.next, limit: PAGE })
    if (!list || !("lines" in list)) return
    const seen = new Set(state.lines.map((l) => l.pos))
    setState({
      lines: [...state.lines, ...list.lines.filter((l) => !seen.has(l.pos))],
      next: list.lines.length < PAGE ? null : list.next,
    })
  }

  async function refreshView() {
    const view = await ask({ op: "view" })
    if (view && "text" in view) setState("view", [...view.text])
  }

  async function change(op: MemoryOp, apply: () => void, undo: () => void): Promise<boolean> {
    setState("error", null)
    apply()
    const result = await client.request(op)
    if (result.ok) return true
    undo()
    setState("error", result.error)
    return false
  }

  async function runSearch(query: string, seq: number) {
    const out = await ask({ op: "search", query })
    if (seq !== searchSeq) return
    if (out && "lines" in out) setState("results", [...out.lines])
  }

  return {
    state,
    load,
    more,
    async refresh() {
      await Promise.all([refreshHead(), refreshView()])
    },
    pin(pos: number, pinned: boolean) {
      void change(
        { op: "pin", pos, pinned },
        () => patch(pos, { pinned }),
        () => patch(pos, { pinned: !pinned }),
      ).then((ok) => {
        if (ok) void refreshView()
      })
    },
    redact(pos: number) {
      const before = state.lines.find((l) => l.pos === pos)
      if (!before) return
      const was = { ...before }
      void change(
        { op: "redact", pos },
        () => patch(pos, { text: "", redacted: true, pinned: false }),
        () => patch(pos, was),
      ).then((ok) => {
        if (ok) void refreshView()
      })
    },
    async note(text: string) {
      const line = text.replace(/\s+/g, " ").trim()
      if (!line) return
      const at = now()
      const temp: LifeLine = { pos: -at, at, text: line, source: "you", pinned: false, redacted: false }
      const ok = await change(
        { op: "note", text: line },
        () => setState("lines", (l) => [temp, ...l]),
        () => setState("lines", (l) => l.filter((x) => x.pos !== temp.pos)),
      )
      if (ok) await refreshHead()
    },
    search(query: string) {
      const seq = ++searchSeq
      clearTimeout(searchTimer)
      setState("results", null)
      if (!query.trim()) return
      searchTimer = setTimeout(() => void runSearch(query, seq), SEARCH_MS)
    },
    async zoom(id: string) {
      if (state.opened[id]) return setState("opened", id, undefined as never)
      const out = await ask({ op: "zoom", id })
      if (out && "text" in out) setState("opened", id, [...out.text])
    },
    async setModel(model: MemoryModel) {
      const before = state.model
      await change(
        { op: "set_model", model },
        () => setState("model", model),
        () => setState("model", before),
      )
    },
    dismissError() {
      setState("error", null)
    },
  }
}
