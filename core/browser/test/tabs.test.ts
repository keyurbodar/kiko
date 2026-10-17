import { afterEach, expect, test } from "bun:test"
import { connect } from "../src/cdp/browser"
import type { Control } from "../src/page/types"
import { findPassages, summarize } from "../src/page/summary"
import { READ_SCRIPT } from "../src/page/script"
import { type FakeCdp, fakeCdp } from "./fake-cdp"

let fake: FakeCdp | undefined
afterEach(() => fake?.stop())

const view = {
  key: "k",
  url: "https://x.test/",
  title: "X",
  text: "hello",
  omitted: 0,
  controls: [
    { id: 1, role: "button", label: "Go" },
    { id: 2, role: "link", label: "Docs", href: "https://x.test/docs" },
  ],
}

const ok = (value: unknown) => ({ result: { type: typeof value, value } })

function page(runtime: (expression: string) => unknown) {
  return fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": (m) => ({ sessionId: `S-${String(m.params.targetId)}` }),
    "Target.getTargetInfo": () => ({ targetInfo: { url: "https://x.test/", title: "X" } }),
    "Target.getTargets": () => ({
      targetInfos: [
        { targetId: "T1", type: "page", url: "https://x.test/", title: "X" },
        { targetId: "OTHER", type: "page", url: "https://other.test/", title: "Other agent" },
      ],
    }),
    "Page.getLayoutMetrics": () => ({ cssContentSize: { width: 800, height: 2000 } }),
    "Page.captureScreenshot": () => ({ data: btoa("hi") }),
    "Runtime.evaluate": (m) => {
      const expression = String(m.params.expression)
      return expression === READ_SCRIPT ? ok(JSON.stringify(view)) : runtime(expression)
    },
  })
}

const sentTo = (method: string) => fake?.sent.filter((m) => m.method === method) ?? []

test("only http and https urls reach the page", async () => {
  fake = page(() => ok(true))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "data:text/html,hi"]) {
    expect(await tab.act({ op: "goto", url })).toEqual({ ok: false, reason: "gone", detail: "only http and https urls" })
  }
  await expect(browser.openTab("javascript:alert(1)")).rejects.toThrow("only http and https urls")
  expect(sentTo("Page.navigate")).toHaveLength(0)
  await browser.close()
})

test("wait for text polls until it appears", async () => {
  let reads = 0
  fake = page((expression) => (expression.includes("innerText") ? ok(++reads > 2 ? "order placed" : "processing") : ok(null)))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.act({ op: "wait", text: "order placed" })).toEqual({ ok: true })
  expect(reads).toBe(3)
  await browser.close()
})

test("wait for gone times out while the text stays", async () => {
  fake = page((expression) => (expression.includes("innerText") ? ok("spinner") : ok(null)))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.act({ op: "wait", gone: "spinner", timeoutMs: 300 })).toEqual({
    ok: false,
    reason: "timeout",
    detail: expect.stringContaining("timed out"),
  })
  await browser.close()
})

test("wait for a fixed ms and for navigation", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.act({ op: "wait", ms: 20 })).toEqual({ ok: true })
  expect(await tab.act({ op: "wait", navigation: true, timeoutMs: 50 })).toEqual({
    ok: false,
    reason: "timeout",
    detail: expect.stringContaining("no page load"),
  })
  await browser.close()
})

test("hover moves the mouse over the control without pressing", async () => {
  fake = page(() => ok({ status: "ok", x: 5, y: 6, menu: false }))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  await tab.read()
  expect(await tab.act({ op: "hover", id: 1 })).toEqual({ ok: true })
  const mouse = sentTo("Input.dispatchMouseEvent").map((m) => m.params)
  expect(mouse).toEqual([{ type: "mouseMoved", x: 5, y: 6 }])
  await browser.close()
})

test("an unanswered dialog never wedges the page: the next call accepts it", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  fake.emit("Page.javascriptDialogOpening", { type: "prompt", message: "name?", url: "" }, "S-T1")
  await Bun.sleep(20)
  expect(sentTo("Page.handleJavaScriptDialog").map((m) => m.params)).toEqual([{ accept: true }])
  expect(tab.takeNotes()).toEqual(['prompt said "name?": accepted'])
  expect(await tab.act({ op: "scroll", direction: "down" })).toEqual({ ok: true })
  await browser.close()
})

test("listTabs reports url and title of the tabs the session opened, in one call, and never another session's tab", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  await browser.openTab()
  expect(await browser.listTabs()).toEqual([{ id: "T1", url: "https://x.test/", title: "X" }])
  expect(sentTo("Target.getTargetInfo")).toHaveLength(0)
  await browser.close()
})

test("fullPage screenshots clip to the layout size beyond the viewport", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.screenshot({ fullPage: true })).toEqual(new Uint8Array([104, 105]))
  expect(sentTo("Page.captureScreenshot").at(-1)?.params).toEqual({
    format: "jpeg",
    quality: 50,
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: 800, height: 2000, scale: 1 },
    captureBeyondViewport: true,
  })
  await tab.screenshot()
  expect(sentTo("Page.captureScreenshot").at(-1)?.params).not.toHaveProperty("clip")
  await browser.close()
})

test("forward and reload navigate the page and wait for its load", async () => {
  fake = fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Page.getNavigationHistory": () => ({ currentIndex: 0, entries: [{ id: 1 }, { id: 2 }] }),
    "Page.navigateToHistoryEntry": (_m, _ws, f) => {
      queueMicrotask(() => f.emit("Page.loadEventFired", { timestamp: 1 }, "S1"))
      return {}
    },
    "Page.reload": (_m, _ws, f) => {
      queueMicrotask(() => f.emit("Page.loadEventFired", { timestamp: 2 }, "S1"))
      return {}
    },
    "Runtime.evaluate": () => ok(true),
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.act({ op: "back" })).toEqual({ ok: false, reason: "gone", detail: "There is no page to go back to." })
  expect(await tab.act({ op: "forward" })).toEqual({ ok: true })
  expect(sentTo("Page.navigateToHistoryEntry").at(-1)?.params).toEqual({ entryId: 2 })
  expect(await tab.act({ op: "reload" })).toEqual({ ok: true })
  expect(sentTo("Page.reload")).toHaveLength(1)
  await browser.close()
})

const control = (id: number, label: string, extra: Partial<Control> = {}): Control => ({ id, role: "link", label, ...extra })

test("find returns the paragraphs that mention the terms, with no model call", () => {
  const text = [
    "The first paragraph is about nothing in particular.",
    "Shah Rukh Khan was born in 1965 in New Delhi.",
    "A third paragraph about films and awards.",
    "Another line naming Khan, with more detail about his career.",
  ].join("\n\n")
  const found = findPassages(text, "shah rukh khan")
  expect(found).toContain("Shah Rukh Khan was born in 1965 in New Delhi.")
  expect(found).toContain("Another line naming Khan")
  expect(found).not.toContain("first paragraph")
})

test("find caps what it returns and says more follow", () => {
  const text = Array.from({ length: 60 }, (_, i) => `needle paragraph ${i} ${"x".repeat(200)}`).join("\n\n")
  const found = findPassages(text, "needle")
  expect(found.length).toBeLessThanOrEqual(8_000)
  expect(found).toContain("more mentions follow")
})

test("find that matches nothing says so", () => {
  expect(findPassages("nothing here", "zebra")).toBe("")
})

test("a summary keeps the controls and paragraphs that match find, and everything without one", () => {
  const view = {
    key: "k",
    url: "https://x.test/",
    title: "Biography",
    text: "Shah Rukh Khan is an actor.\n\nOther text.",
    omitted: 0,
    controls: [control(1, "Khan on Wikimedia Commons"), control(2, "Edit")],
  }
  const found = summarize(view, "khan")
  expect(found).toContain('1 link "Khan on Wikimedia Commons"')
  expect(found).not.toContain('2 link "Edit"')
  expect(found).toContain("Shah Rukh Khan is an actor.")
  expect(found).not.toContain("Other text.")
  const whole = summarize(view)
  expect(whole).toContain('2 link "Edit"')
  expect(whole).toContain("Other text.")
  expect(summarize(view, "zebra")).toContain("nothing on this page mentions zebra")
})
