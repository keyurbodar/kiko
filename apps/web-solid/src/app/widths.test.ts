import { expect, test } from "bun:test"
import { CHAT_MIN, defaultWidth, fitWidths, INFO, initialSizes, readWidth, resetWidth, SIDEBAR } from "./widths"

const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
})

test("a reset puts a dragged column back to its default width and remembers it", () => {
  for (const rule of [SIDEBAR, INFO]) {
    store.set(rule.key, String(rule.max))
    const sizes: string[] = []
    resetWidth(rule, { resize: (size) => sizes.push(size) })
    const want = defaultWidth(rule, globalThis.innerWidth)
    expect(sizes).toEqual([`${want}px`])
    expect(readWidth(rule)).toBe(want)
  }
})

test("a double reset after a drag returns to the same default twice", () => {
  store.set(INFO.key, String(INFO.max))
  const sizes: string[] = []
  const panel = { resize: (size: `${number}px`) => void sizes.push(size) }
  resetWidth(INFO, panel)
  store.set(INFO.key, "500")
  resetWidth(INFO, panel)
  expect(sizes[0]).toBe(sizes[1])
  expect(readWidth(INFO)).toBe(defaultWidth(INFO, globalThis.innerWidth))
})

test("the right panel takes a share of the window, within its limits", () => {
  expect(defaultWidth(INFO, 1280)).toBe(Math.round(1280 * 0.26))
  expect(defaultWidth(INFO, 900)).toBe(INFO.min)
  expect(defaultWidth(INFO, 3840)).toBe(INFO.max)
  expect(defaultWidth(SIDEBAR, 3840)).toBe(SIDEBAR.fallback)
})

test("a narrower window shrinks the columns instead of the chat", () => {
  const fitted = fitWidths(1000, 280, 600)
  expect(fitted.sidebar + fitted.info).toBeLessThanOrEqual(1000 - CHAT_MIN)
  expect(fitWidths(1440, 280, 380)).toEqual({ sidebar: 280, info: 380 })
})

const px = (width: number, sidebar: number | null, info: number | null) => {
  const s = initialSizes(width, sidebar, info)
  return [s.sidebar, s.chat, s.info].map((f) => Math.round(f * width))
}

test("the three columns add up to the window", () => {
  const s = initialSizes(1440, 280, 340)
  expect(s.sidebar + s.chat + s.info).toBeCloseTo(1, 10)
  expect(px(1440, 280, 340)).toEqual([280, 820, 340])
})

test("a collapsed sidebar or a closed panel gives its width to the chat", () => {
  expect(px(1440, 0, 340)).toEqual([0, 1100, 340])
  expect(px(1440, 280, 0)).toEqual([280, 1160, 0])
  expect(px(800, 300, null)).toEqual([300, 500, 0])
})

test("the chat keeps its floor when the saved widths do not fit", () => {
  for (const [sidebar, info] of [[420, 560], [300, 400]] as const) {
    const [, chat] = px(1000, sidebar, info)
    expect(chat).toBeGreaterThanOrEqual(CHAT_MIN)
  }
})
