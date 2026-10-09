import { createSignal } from "solid-js"

// Which models the chat's model picker leaves out, after opencode's models settings (MIT,
// packages/app/src/components/settings-v2/models.tsx). Refs are `provider/model`. Like the chosen
// model (chat-model.ts) they live in this browser's localStorage and hold no secret.
const KEY = "yuki.model-prefs"

/** Stored hidden refs, or none for anything unreadable. */
export function parseHidden(text: string | null): readonly string[] {
  try {
    const value = JSON.parse(text ?? "{}") as { hidden?: unknown }
    return Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((x): x is string => typeof x === "string"))] : []
  } catch {
    return []
  }
}

function read(): readonly string[] {
  try {
    return parseHidden(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

const [hidden, setHiddenList] = createSignal<readonly string[]>(read())

/** The models the picker leaves out. */
export const hiddenModels = hidden

/** Shows or hides models in the picker. */
export function setHidden(refs: readonly string[], hide: boolean) {
  const set = new Set(hidden())
  for (const ref of refs) hide ? set.add(ref) : set.delete(ref)
  const next = [...set]
  setHiddenList(next)
  try {
    localStorage.setItem(KEY, JSON.stringify({ hidden: next }))
  } catch {}
}
