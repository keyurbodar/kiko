import { createRoot, createSignal } from "solid-js"
import { type CommandId, isCommandId } from "./ids"

export type Bindings = Readonly<Partial<Record<CommandId, string | null>>>

const KEY = "kiko.keybindings"

function parseBindings(text: string | null): Bindings {
  try {
    const value: unknown = JSON.parse(text ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (e): e is [CommandId, string | null] =>
          isCommandId(e[0]) && (e[1] === null || (typeof e[1] === "string" && e[1] !== "")),
      ),
    )
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

export { bindings }

function write(next: Bindings): void {
  setBindings(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

export function bindKey(id: CommandId, key: string | null): void {
  write({ ...bindings(), [id]: key })
}

export function resetKey(id: CommandId): void {
  const { [id]: _, ...rest } = bindings()
  write(rest)
}

export function resetAllKeys(): void {
  write({})
}

if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === KEY && setBindings(read()))
