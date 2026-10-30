export const EXPLORER_WIDTH_KEY = "kiko:files:explorer-width"
export const EXPLORER_MIN = 160
export const EXPLORER_MAX = 560
const FILE_CONTENT_MIN = 256
export const EXPLORER_STEP = 16

type Store = Pick<Storage, "getItem"> | undefined

export function clampExplorerWidth(value: number, rowWidth: number): number {
  const ceiling = Math.max(EXPLORER_MIN, Math.min(EXPLORER_MAX, rowWidth - FILE_CONTENT_MIN))
  return Math.max(EXPLORER_MIN, Math.min(ceiling, value))
}

export function readExplorerWidth(store: Store = globalThis.localStorage): number {
  try {
    const value = Number(store?.getItem(EXPLORER_WIDTH_KEY) ?? "")
    if (!Number.isFinite(value) || value <= 0) return 256
    return Math.max(EXPLORER_MIN, Math.min(EXPLORER_MAX, value))
  } catch {
    return 256
  }
}

export function saveExplorerWidth(
  value: number,
  store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
) {
  try {
    store?.setItem(EXPLORER_WIDTH_KEY, String(Math.round(value)))
  } catch {}
}
