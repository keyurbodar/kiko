import { describe, expect, test } from "bun:test"
import type { debounce } from "@solid-primitives/scheduled"
import { createRoot } from "solid-js"
import { createIntent } from "./intent"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A cancellable timer. The real `debounce` does nothing under the server build that `bun test` loads. */
const timer: typeof debounce = (fn, wait) => {
  let id: ReturnType<typeof setTimeout> | undefined
  const run = ((...args: Parameters<typeof fn>) => {
    clearTimeout(id)
    id = setTimeout(() => fn(...args), wait)
  }) as ReturnType<typeof debounce>
  run.clear = () => clearTimeout(id)
  return run
}

function setup(allowed = () => true) {
  const el = new EventTarget()
  let calls = 0
  const dispose = createRoot((dispose) => {
    createIntent(el, () => calls++, { delayMs: 20, allowed, timer })
    return dispose
  })
  return { el, calls: () => calls, dispose }
}

describe("intent", () => {
  test("hover that rests fires once", async () => {
    const t = setup()
    t.el.dispatchEvent(new Event("pointerenter"))
    await sleep(50)
    expect(t.calls()).toBe(1)
    t.dispose()
  })

  test("moving across ten rows without stopping preloads nothing", async () => {
    const rows = Array.from({ length: 10 }, () => setup())
    for (const row of rows) {
      row.el.dispatchEvent(new Event("pointerenter"))
      await sleep(4)
      row.el.dispatchEvent(new Event("pointerleave"))
    }
    await sleep(50)
    expect(rows.reduce((n, r) => n + r.calls(), 0)).toBe(0)
    rows.forEach((r) => r.dispose())
  })

  test("pointer down fires at once and cancels the pending hover", async () => {
    const t = setup()
    t.el.dispatchEvent(new Event("pointerenter"))
    t.el.dispatchEvent(new Event("pointerdown"))
    expect(t.calls()).toBe(1)
    await sleep(50)
    expect(t.calls()).toBe(1)
    t.dispose()
  })

  test("keyboard focus fires at once", () => {
    const t = setup()
    t.el.dispatchEvent(new Event("focusin"))
    expect(t.calls()).toBe(1)
    t.dispose()
  })

  test("nothing fires while not allowed", async () => {
    const t = setup(() => false)
    t.el.dispatchEvent(new Event("pointerenter"))
    t.el.dispatchEvent(new Event("pointerdown"))
    t.el.dispatchEvent(new Event("focusin"))
    await sleep(50)
    expect(t.calls()).toBe(0)
    t.dispose()
  })

  test("disposing cancels a pending hover", async () => {
    const t = setup()
    t.el.dispatchEvent(new Event("pointerenter"))
    t.dispose()
    await sleep(50)
    expect(t.calls()).toBe(0)
  })
})
