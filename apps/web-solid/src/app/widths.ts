export const SIDEBAR = { key: "kiko:sidebar-width", min: 220, max: 420, fallback: 280 }
export const INFO = { key: "kiko:info-width", min: 280, max: 720, fallback: 340 }
export const CHAT_MIN = 360

type Rule = typeof SIDEBAR

export function readWidth(rule: Rule): number {
  try {
    const value = Number(localStorage.getItem(rule.key))
    return value >= rule.min && value <= rule.max ? Math.round(value) : rule.fallback
  } catch {
    return rule.fallback
  }
}

/** Saves the width a panel has right now. A collapsed panel keeps the width it had. */
export function saveWidth(rule: Rule, panelId: string) {
  const width = Math.round(document.getElementById(panelId)?.getBoundingClientRect().width ?? 0)
  if (width < rule.min) return
  try {
    localStorage.setItem(rule.key, String(Math.min(rule.max, width)))
  } catch {}
}

/** Puts a column back to its default width, the one a double click on its handle restores. */
export function resetWidth(rule: Rule, panel: { resize: (size: string) => void } | undefined) {
  panel?.resize(`${rule.fallback}px`)
  try {
    localStorage.setItem(rule.key, String(rule.fallback))
  } catch {}
}

/**
 * The three columns as fractions of the window, for Corvu's first layout. A collapsed or absent
 * column is 0, and the chat takes the rest. A column gives way before the chat drops under 360 px.
 */
export function initialSizes(width: number, sidebar: number | null, info: number | null) {
  let side = sidebar ?? 0
  let right = info ?? 0
  const room = Math.max(0, width - CHAT_MIN)
  if (right > 0) right = Math.max(INFO.min, Math.min(right, room - side))
  if (side > 0 && side + right > room) side = Math.max(SIDEBAR.min, room - right)
  return { sidebar: side / width, info: right / width, chat: 1 - side / width - right / width }
}
