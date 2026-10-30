export const SIDEBAR = { key: "kiko:device:sidebar-width", min: 220, max: 420, fallback: 296, floor: 296 }
export const INFO = { key: "kiko:device:info-width", min: 320, max: 760, fallback: 400 }
export const CHAT_MIN = 360
export const PANEL_CHAT_MIN = 420

export const panelMaxWidth = (viewport: number) => Math.min(INFO.max, Math.round(viewport * 0.6))

export function readPanelWidth(viewport: number): number {
  return Math.max(INFO.min, Math.min(readWidth(INFO), panelMaxWidth(viewport)))
}

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

export function saveWidth(rule: Rule, panelId: string) {
  const width = Math.round(document.getElementById(panelId)?.getBoundingClientRect().width ?? 0)
  if (width < rule.min) return
  try {
    localStorage.setItem(rule.key, String(Math.min(rule.max, width)))
  } catch {}
}

export function resetWidth(rule: Rule, panel: { resize: (size: `${number}px`) => void } | undefined) {
  const width = defaultWidth(rule)
  panel?.resize(`${width}px`)
  try {
    localStorage.setItem(rule.key, String(width))
  } catch {}
}

export function fitWidths(viewport: number, sidebar: number, info: number) {
  const room = Math.max(0, viewport - CHAT_MIN)
  const side = sidebar > 0 ? Math.max(SIDEBAR.floor ?? SIDEBAR.min, sidebar) : 0
  const want = info > 0 ? readPanelWidth(viewport) : 0
  const right = side + want <= room ? want : 0
  return { sidebar: Math.min(side, room), info: right }
}

export function initialSizes(width: number, sidebar: number | null, info: number | null) {
  const side = sidebar ?? 0
  const room = Math.max(0, width - CHAT_MIN)
  const right = info !== null && info > 0 ? Math.min(info, Math.max(0, room - side)) : 0
  return { sidebar: side / width, info: right / width, chat: 1 - side / width - right / width }
}
