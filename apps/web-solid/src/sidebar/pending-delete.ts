import { createSignal } from "solid-js"

const without = (set: ReadonlySet<string>, id: string) => new Set([...set].filter((x) => x !== id))

type Timers = { commit: ReturnType<typeof setTimeout>; fold: ReturnType<typeof setTimeout> }

export function createPendingDeletes(options: { undoMs: number; foldMs: number; commit: (id: string) => void }) {
  const [leaving, setLeaving] = createSignal<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set())
  const pending = new Map<string, Timers>()

  const settle = (id: string) => {
    const timers = pending.get(id)
    if (!timers) return false
    pending.delete(id)
    clearTimeout(timers.commit)
    clearTimeout(timers.fold)
    setLeaving((all) => without(all, id))
    setHidden((all) => without(all, id))
    return true
  }

  const flush = (id: string) => {
    if (settle(id)) options.commit(id)
  }

  return {
    isLeaving: (id: string) => leaving().has(id),
    isHidden: (id: string) => hidden().has(id),
    has: (id: string) => pending.has(id),
    start(id: string) {
      if (pending.has(id)) return
      setLeaving((all) => new Set(all).add(id))
      pending.set(id, {
        commit: setTimeout(() => flush(id), options.undoMs),
        fold: setTimeout(() => {
          setLeaving((all) => without(all, id))
          setHidden((all) => new Set(all).add(id))
        }, options.foldMs),
      })
    },
    undo: (id: string) => settle(id),
    flushAll() {
      for (const id of pending.keys()) flush(id)
    },
  }
}
