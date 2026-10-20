import { createSignal } from "solid-js"

const MARKS = "kiko:marked-unread"

const saved = (): ReadonlySet<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(MARKS) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

const [forced, setForcedSignal] = createSignal<ReadonlySet<string>>(saved())

const setForced = (update: (marks: ReadonlySet<string>) => ReadonlySet<string>) => {
  const next = update(forced())
  setForcedSignal(next)
  try {
    localStorage.setItem(MARKS, JSON.stringify([...next]))
  } catch {
  }
}

export const markedUnread = (id: string): boolean => forced().has(id)

export function markUnread(id: string): void {
  setForced((s) => new Set(s).add(id))
}

export function clearUnreadMark(id: string): void {
  if (!forced().has(id)) return
  setForced((s) => {
    const next = new Set(s)
    next.delete(id)
    return next
  })
}
