export const SIDEBAR = { key: "kiko:device:sidebar-width", min: 220, max: 420, fallback: 296, floor: 296 }
export const INFO = { key: "kiko:device:info-width", min: 360, max: 4096, fallback: 540 }
export const CHAT_MIN = 360
export const RAIL = 56

const PANEL_MAX_TENTHS = 7

export function panelMaxWidth(viewport: number, row?: number): number {
  const fractionCap = Math.floor((viewport * PANEL_MAX_TENTHS) / 10)
  const rowCap = row === undefined ? Infinity : Math.floor(row) - CHAT_MIN
  return Math.max(INFO.min, Math.min(fractionCap, rowCap))
}

export const clampPanelWidth = (width: number, max: number) => Math.max(INFO.min, Math.min(max, width))

type Rule = { key: string; min: number; max: number; fallback: number; floor?: number }

export function defaultWidth(rule: Rule): number {
  return Math.round(Math.max(rule.min, Math.min(rule.max, rule.fallback)))
}

export function readWidth(rule: Rule): number {
  const fallback = defaultWidth(rule)
  try {
    const value = Number(localStorage.getItem(rule.key))
    return value >= rule.min && value <= rule.max ? Math.round(value) : fallback
  } catch {
    return fallback
  }
}

export function writeWidth(rule: Rule, width: number) {
  try {
    localStorage.setItem(rule.key, String(Math.round(Math.max(rule.min, Math.min(rule.max, width)))))
  } catch {}
}

export function saveWidth(rule: Rule, panelId: string) {
  const width = Math.round(document.getElementById(panelId)?.getBoundingClientRect().width ?? 0)
  if (width < rule.min) return
  writeWidth(rule, width)
}

export function resetWidth(rule: Rule, panel: { resize: (size: `${number}px`) => void } | undefined) {
  const width = defaultWidth(rule)
  panel?.resize(`${width}px`)
  writeWidth(rule, width)
}

export function fitSidebar(viewport: number, sidebar: number) {
  const room = Math.max(0, viewport - CHAT_MIN)
  const side = sidebar <= 0 ? 0 : sidebar <= RAIL ? RAIL : Math.max(SIDEBAR.floor ?? SIDEBAR.min, sidebar)
  return Math.min(side, room)
}
