export const SIDEBAR = { key: "kiko:sidebar-width", min: 220, max: 420, fallback: 280 }
export const INFO = { key: "kiko:info-width", min: 280, max: 560, fallback: 340 }
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
