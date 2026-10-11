import { afterEach, expect, test } from "bun:test"
import { connect } from "../src/cdp/browser"
import { BROWSER } from "../src/config"
import { formatAllText } from "../src/page/extract"
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
    { id: 2, role: "file", label: "Resume" },
  ],
}

const ok = (value: unknown) => ({ result: { type: typeof value, value } })

function page(runtime: (expression: string) => unknown) {
  return fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": (m) => ({ sessionId: `S-${String(m.params.targetId)}` }),
    "Target.getTargetInfo": () => ({ targetInfo: { url: "https://x.test/", title: "X" } }),
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

test("upload sets the files on the file input the id names", async () => {
  let fileInput = true
  fake = page((expression) => {
    if (!expression.includes('el.type === "file"')) return ok(null)
    return fileInput ? { result: { type: "object", objectId: "O1" } } : { result: { type: "undefined" } }
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  await tab.read()
  expect(await tab.act({ op: "upload", id: 2, paths: ["/tmp/cv.pdf"] })).toEqual({ ok: true })
  expect(sentTo("DOM.setFileInputFiles").map((m) => m.params)).toEqual([{ files: ["/tmp/cv.pdf"], objectId: "O1" }])
  fileInput = false
  expect(await tab.act({ op: "upload", id: 2, paths: ["/tmp/cv.pdf"] })).toEqual({
    ok: false,
    reason: "gone",
    detail: "that control is not a file input",
  })
  await browser.close()
})

test("eval returns the JSON value or the exception", async () => {
  fake = page((expression) => {
    if (expression.includes("nope")) {
      return {
        result: { type: "object" },
        exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: nope is not defined" } },
      }
    }
    return ok(2)
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.eval("1 + 1")).toEqual({ ok: true, value: "2" })
  expect(sentTo("Runtime.evaluate").at(-1)?.params).toMatchObject({ returnByValue: true, awaitPromise: true })
  expect(await tab.eval("nope")).toEqual({ ok: false, error: "ReferenceError: nope is not defined" })
  await browser.close()
})

test("extract returns the compact shapes for links, tables, forms, headings, and text", async () => {
  fake = page((expression) => {
    if (expression.includes('querySelectorAll("a[href]")')) {
      return ok(JSON.stringify([["Home", "https://x.test/"], ["Docs", "https://x.test/docs"]]))
    }
    if (expression.includes('querySelectorAll("table")')) {
      return ok(JSON.stringify({ tables: [{ header: ["Item", "Qty"], rows: [["pen", "2"]], moreRows: 0 }], more: 0 }))
    }
    if (expression.includes("document.forms")) {
      return ok(
        JSON.stringify({
          forms: [
            {
              action: "/search",
              method: "get",
              fields: [
                { id: 2, kind: "text", label: "Query", value: "" },
                { id: 3, kind: "button", label: "Go", value: "" },
              ],
              moreFields: 0,
            },
          ],
          more: 0,
        }),
      )
    }
    if (expression.includes('querySelectorAll("h1')) return ok(JSON.stringify([[1, "Welcome"], [2, "News"]]))
    return ok("Welcome to the site")
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect(await tab.extract("links")).toBe("Home -> https://x.test/\nDocs -> https://x.test/docs")
  expect(await tab.extract("tables")).toBe("table 1\nItem|Qty\npen|2")
  expect(await tab.extract("forms")).toBe("form 1 GET /search\n  [2] Query (text)\n  [3] Go (button)")
  expect(await tab.extract("headings")).toBe("h1 Welcome\nh2 News")
  expect(await tab.extract("all_text")).toBe("Welcome to the site")
  expect(formatAllText("x".repeat(13_000))).toHaveLength(12_000)
  await browser.close()
})

test("a confirm is held until answered and an alert is accepted", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  fake.emit("Page.javascriptDialogOpening", { type: "alert", message: "hi", url: "" }, "S-T1")
  fake.emit("Page.javascriptDialogOpening", { type: "confirm", message: "sure?", url: "" }, "S-T1")
  await tab.read()
  expect(await tab.eval("1")).toEqual({ ok: false, error: expect.stringContaining("confirm") })
  expect(sentTo("Page.handleJavaScriptDialog").map((m) => m.params)).toEqual([{ accept: true }])
  expect(tab.dialog()).toEqual({ type: "confirm", message: "sure?" })
  expect(await tab.answerDialog(true)).toBe(true)
  expect(tab.dialog()).toBeNull()
  expect(sentTo("Page.handleJavaScriptDialog").at(-1)?.params).toEqual({ accept: true })
  expect(await tab.answerDialog(true)).toBe(false)
  await browser.close()
})

test("an unanswered confirm is dismissed by the next call once the hold has passed", async () => {
  fake = page(() => ok(null))
  let clock = 0
  const browser = await connect(fake.url, { now: () => clock })
  const tab = await browser.openTab()
  fake.emit("Page.javascriptDialogOpening", { type: "confirm", message: "sure?", url: "" }, "S-T1")
  await tab.read()
  clock = BROWSER.dialogHoldMs - 1
  expect(tab.dialog()).toEqual({ type: "confirm", message: "sure?" })
  clock = BROWSER.dialogHoldMs
  expect(tab.dialog()).toBeNull()
  await Bun.sleep(20)
  expect(sentTo("Page.handleJavaScriptDialog").at(-1)?.params).toEqual({ accept: false })
  await browser.close()
})

test("closing a tab with an open dialog drops the dialog", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  fake.emit("Page.javascriptDialogOpening", { type: "prompt", message: "name?", url: "" }, "S-T1")
  await tab.read()
  expect(await tab.eval("1")).toEqual({ ok: false, error: expect.stringContaining("prompt") })
  expect(tab.dialog()).toEqual({ type: "prompt", message: "name?" })
  await tab.close()
  expect(tab.dialog()).toBeNull()
  await browser.close()
})

test("listTabs reports url and title of the tabs the session opened", async () => {
  fake = page(() => ok(null))
  const browser = await connect(fake.url)
  await browser.openTab()
  expect(await browser.listTabs()).toEqual([{ id: "T1", url: "https://x.test/", title: "X" }])
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
