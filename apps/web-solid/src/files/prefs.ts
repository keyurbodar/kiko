import { createSignal } from "solid-js"

function stored(key: string, fallback: boolean) {
  let initial = fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) initial = raw === "1"
  } catch {}
  const [get, set] = createSignal(initial)
  const save = (value: boolean) => {
    set(value)
    try {
      localStorage.setItem(key, value ? "1" : "0")
    } catch {}
  }
  return [get, save] as const
}

export const PREFS = {
  markdown: stored("kiko:device:file-render-markdown", true),
  table: stored("kiko:device:file-render-table", true),
  html: stored("kiko:device:file-render-html", false),
}
const ABOUT_KEY = "kiko:device:file-about"
function readAbout(): boolean | null {
  try {
    const raw = localStorage.getItem(ABOUT_KEY)
    return raw === null ? null : raw === "1"
  } catch {
    return null
  }
}
const [aboutPref, setAboutPref] = createSignal<boolean | null>(readAbout())
const [roomy, setRoomyValue] = createSignal(true)
export const setRoomy = setRoomyValue
export const aboutOpen = () => aboutPref() ?? roomy()
export function setAboutOpen(open: boolean) {
  setAboutPref(open)
  try {
    localStorage.setItem(ABOUT_KEY, open ? "1" : "0")
  } catch {}
}
export const [wrap, setWrap] = stored("kiko:device:file-word-wrap", true)
export const [fullSize, setFullSize] = createSignal(false)
