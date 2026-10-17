import { createRoot, createSignal } from "solid-js"

/*
 * The owner's own shortcuts, by command id. A command left out keeps its default; null takes its key
 * away. They live in this browser's localStorage, not on the server, because a Mac and a Windows
 * laptop want different keys.
 */
export type Bindings = Readonly<Record<string, string | null>>

const KEY = "kiko.keybindings"

/** Stored bindings, or none for anything unreadable. */
export function parseBindings(text: string | null): Bindings {
  try {
    const value: unknown = JSON.parse(text ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string | null] => e[1] === null || (typeof e[1] === "string" && e[1] !== "")))
  } catch {
    return {}
  }
}

function read(): Bindings {
  try {
    return parseBindings(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

const [bindings, setBindings] = createRoot(() => createSignal<Bindings>(read()))

/** The owner's bindings. Reactive. */
export { bindings }

function write(next: Bindings): void {
  setBindings(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

/** Gives a command this key, or no key for null. */
export function bindKey(id: string, key: string | null): void {
  write({ ...bindings(), [id]: key })
}

/** Puts one command back on its default key. */
export function resetKey(id: string): void {
  const { [id]: _, ...rest } = bindings()
  write(rest)
}

/** Puts every command back on its default key. */
export function resetAllKeys(): void {
  write({})
}

// Another tab's change applies here too.
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === KEY && setBindings(read()))
