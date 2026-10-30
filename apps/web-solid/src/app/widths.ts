export const SIDEBAR = { key: "kiko:device:sidebar-width", min: 220, max: 420, fallback: 296, floor: 296 }
export const INFO = { key: "kiko:device:info-width", min: 320, max: 900, fallback: 620 }
export const CHAT_MIN = 360

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
  let right = info > 0 ? Math.max(INFO.min, info) : 0
  let side = sidebar > 0 ? Math.max(SIDEBAR.floor ?? SIDEBAR.min, sidebar) : 0
  if (side + right > room) right = Math.max(INFO.min, room - side)
  if (side + right > room) side = Math.max(0, room - right)
  return { sidebar: side, info: right }
}

export function initialSizes(width: number, sidebar: number | null, info: number | null) {
  let side = sidebar ?? 0
  let right = info ?? 0
  const room = Math.max(0, width - CHAT_MIN)
  if (right > 0) right = Math.max(INFO.min, Math.min(right, room - side))
  if (side > 0 && side + right > room) side = Math.max(SIDEBAR.floor ?? SIDEBAR.min, room - right)
  return { sidebar: side / width, info: right / width, chat: 1 - side / width - right / width }
}
