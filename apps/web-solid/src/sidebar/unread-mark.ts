import { createSignal } from "solid-js"

/*
 * "Mark as unread", as a client-only overlay. The protocol has no such op, so the mark lives on
 * this device and a reload keeps it. It is cleared when the chat is opened, whichever door was used.
 *
 * Its own module because two unrelated callers need it: the sidebar's menu, and the chat route,
 * which clears it whenever a chat becomes active. Importing the sidebar's actions from the route
 * pulled the whole action table into the chat's chunk for one call.
 */

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
    // Blocked storage keeps the mark for this tab only.
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
