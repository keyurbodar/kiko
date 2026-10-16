import { createSignal } from "solid-js"

export type ModelsTab = "agents" | "providers"

const KEY = "kiko.models-tab"

function read(): ModelsTab {
  try {
    return localStorage.getItem(KEY) === "providers" ? "providers" : "agents"
  } catch {
    return "agents"
  }
}

const [tab, setTab] = createSignal<ModelsTab>(read())

/** The tab the Models page shows. It lives in this browser's localStorage. */
export const modelsTab = tab

export function setModelsTab(next: ModelsTab) {
  setTab(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {}
}
