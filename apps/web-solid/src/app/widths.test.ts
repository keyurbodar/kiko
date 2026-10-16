import { expect, test } from "bun:test"
import { CHAT_MIN, INFO, initialSizes, readWidth, resetWidth, SIDEBAR } from "./widths"

const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
})

test("a reset puts a dragged column back to its default width and remembers it", () => {
  for (const rule of [SIDEBAR, INFO]) {
    store.set(rule.key, String(rule.max))
    const sizes: string[] = []
    resetWidth(rule, { resize: (size) => sizes.push(size) })
    expect(sizes).toEqual([`${rule.fallback}px`])
    expect(readWidth(rule)).toBe(rule.fallback)
  }
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
