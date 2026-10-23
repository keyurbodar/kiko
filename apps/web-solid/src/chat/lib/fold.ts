export function collapseLimit(viewportHeight: number, coarse: boolean): number {
  const share = coarse ? 0.85 : 0.72
  const floor = Math.min(coarse ? 360 : 480, Math.round(viewportHeight * 0.6))
  return Math.round(Math.max(floor, Math.min(coarse ? 760 : 900, viewportHeight * share)))
}

export const FOLD_SLACK = 0.25

export function shouldFold(contentHeight: number, limit: number, fixed = false): boolean {
  return !fixed && contentHeight > limit * (1 + FOLD_SLACK)
}

export const FOLD_BUTTON_PX = 22

let cached: { height: number; coarse: boolean; limit: number } | undefined

export function foldLimitFor(height: number): number {
  const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false
  const usable = Math.max(240, height - FOLD_BUTTON_PX)
  if (!cached || cached.height !== usable || cached.coarse !== coarse)
    cached = { height: usable, coarse, limit: collapseLimit(usable, coarse) }
  return cached.limit
}

export function currentLimit(): number {
  return foldLimitFor(globalThis.innerHeight ?? 900)
}
