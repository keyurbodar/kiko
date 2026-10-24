export type Intent =
  | "close"
  | "unpeek"
  | "clear-picks"
  | "next-tab"
  | "previous-tab"
  | "trap-tab"
  | "folder-up"
  | "leave-view"
  | "actions"
  | "attach"
  | "ask"
  | "extend"
  | "open-folder"
  | "toggle-peek"
  | "pick"
  | "pick-all"

export interface KeyContext {
  root: boolean
  files: boolean
  empty: boolean
  peeking: boolean
  picked: number
  inFolder: boolean
  inView: boolean
  hasActions: boolean
  onFile: boolean
  onFolder: boolean
}

export interface KeyLike {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

function escapeIntent(c: KeyContext): Intent {
  if (c.peeking) return "unpeek"
  return c.picked > 0 ? "clear-picks" : "close"
}

function browseIntent(e: KeyLike, c: KeyContext): Intent | undefined {
  if (e.key === "ArrowRight") return c.onFolder ? "open-folder" : c.onFile ? "toggle-peek" : undefined
  if (e.key === "ArrowLeft") return c.peeking ? "unpeek" : c.inFolder ? "folder-up" : undefined
  if (e.key === " " && c.onFile) return "pick"
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") return "pick-all"
  return undefined
}

function enterIntent(e: KeyLike, c: KeyContext): Intent | undefined {
  if (e.altKey && c.hasActions) return "actions"
  if (e.metaKey || e.ctrlKey) return c.picked > 0 ? "attach" : "ask"
  return undefined
}

export function intentOf(e: KeyLike, c: KeyContext): Intent | undefined {
  if (e.key === "Escape") return escapeIntent(c)
  if (e.key === "Tab") return c.root ? (e.shiftKey ? "previous-tab" : "next-tab") : "trap-tab"
  if (e.key === "Backspace" && c.empty) {
    if (c.files && c.inFolder) return "folder-up"
    return c.inView ? "leave-view" : undefined
  }
  if (e.key === "Enter") return enterIntent(e, c)
  if (e.shiftKey && c.files && (e.key === "ArrowDown" || e.key === "ArrowUp")) return "extend"
  return c.files && c.empty ? browseIntent(e, c) : undefined
}
