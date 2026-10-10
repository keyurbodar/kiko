import { afterEach, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { connect } from "../src/cdp/browser"
import { READ_SCRIPT } from "../src/page/script"
import { type FakeCdp, fakeCdp } from "./fake-cdp"

let fake: FakeCdp | undefined
afterEach(() => fake?.stop())

function chrome() {
  let target = 0
  return fakeCdp({
    "Target.createTarget": () => ({ targetId: `T${++target}` }),
    "Target.attachToTarget": (message) => ({ sessionId: `S-${message.params.targetId}` }),
    "Runtime.evaluate": () => ({ result: { type: "undefined" } }),
  })
}

const sentTo = (f: FakeCdp, method: string, sessionId?: string) =>
  f.sent.filter((m) => m.method === method && (sessionId === undefined || m.sessionId === sessionId))

test("each tab opens in the background, attaches flat, and gets focus emulation", async () => {
  fake = chrome()
  const browser = await connect(fake.url)
  const [a, b] = await Promise.all([browser.openTab(), browser.openTab()])
  expect(sentTo(fake, "Target.createTarget").every((m) => m.params.background === true && m.params.newWindow === true)).toBe(true)
  expect(sentTo(fake, "Target.attachToTarget").every((m) => m.params.flatten === true)).toBe(true)
  for (const tab of [a, b]) {
    expect(sentTo(fake, "Emulation.setFocusEmulationEnabled", `S-${tab.id}`)[0]?.params).toEqual({ enabled: true })
  }
  expect(browser.tab(a.id)).toBe(a)
  await browser.close()
  await browser.closed
})

test("a confirm is dismissed and the next act reports it; an alert is accepted and does not", async () => {
  fake = chrome()
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  const session = `S-${tab.id}`

  fake.emit("Page.javascriptDialogOpening", { type: "alert", message: "hi", url: "", hasBrowserHandler: false }, session)
  await Bun.sleep(20)
  expect(sentTo(fake, "Page.handleJavaScriptDialog", session).at(-1)?.params).toEqual({ accept: true })
  expect(await tab.act({ op: "scroll", direction: "down" })).toEqual({ ok: true })

  fake.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Delete?", url: "", hasBrowserHandler: false }, session)
  await Bun.sleep(20)
  expect(sentTo(fake, "Page.handleJavaScriptDialog", session).at(-1)?.params).toEqual({ accept: false })
  const result = await tab.act({ op: "scroll", direction: "down" })
  expect(result.ok).toBe(false)
  expect(!result.ok && result.reason).toBe("dialog")
  expect(await tab.act({ op: "scroll", direction: "down" })).toEqual({ ok: true })
  await browser.close()
})

test("a page our tab opens becomes a tab reported to onPopup; a stranger's page does not", async () => {
  fake = chrome()
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  const popups: [string, string][] = []
  browser.onPopup((opener, popup) => popups.push([opener, popup.id]))
  const info = { type: "page", title: "", url: "https://x.test", attached: false, canAccessOpener: true }
  fake.emit("Target.targetCreated", { targetInfo: { ...info, targetId: "OTHER", openerId: "NOT-OURS" } })
  fake.emit("Target.targetCreated", { targetInfo: { ...info, targetId: "POP", openerId: tab.id } })
  await Bun.sleep(50)
  expect(popups).toEqual([[tab.id, "POP"]])
  expect(browser.tab("POP")?.id).toBe("POP")
  expect(browser.tab("OTHER")).toBeUndefined()
  expect(sentTo(fake, "Emulation.setFocusEmulationEnabled", "S-POP")).toHaveLength(1)
  await browser.close()
})

const view = (url: string) => JSON.stringify({ key: url, url, title: "", controls: [{ id: 1, role: "link", label: "next" }], text: "", omitted: 0 })

test("an action's settle rides in the next read's evaluate, so act then read costs one round trip less", async () => {
  fake = fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Runtime.evaluate": (m) => ({ result: { type: "string", value: String(m.params.expression).includes("data-yuki-id") ? view("https://a.test/") : "" } }),
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  expect((await tab.read()).url).toBe("https://a.test/")
  const before = sentTo(fake, "Runtime.evaluate").length
  expect(await tab.act({ op: "scroll", direction: "down" })).toEqual({ ok: true })
  await tab.read()
  const sent = sentTo(fake, "Runtime.evaluate").slice(before)
  expect(sent).toHaveLength(2)
  expect(String(sent[1]?.params.expression)).toContain("requestAnimationFrame")
  expect(sent[1]?.params.awaitPromise).toBe(true)
  await browser.close()
})

test("a navigation that starts while the read settles waits for load and reads the new page", async () => {
  let reads = 0
  fake = fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Runtime.evaluate": (m, _ws, f) => {
      if (!String(m.params.expression).includes("data-yuki-id")) return { result: { type: "undefined" } }
      reads++
      if (reads === 2) {
        f.emit("Page.frameStartedLoading", { frameId: "T1" }, "S1")
        setTimeout(() => f.emit("Page.loadEventFired", { timestamp: 1 }, "S1"), 30)
      }
      return { result: { type: "string", value: view(reads >= 3 ? "https://b.test/" : "https://a.test/") } }
    },
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  await tab.read()
  await tab.act({ op: "scroll", direction: "down" })
  expect((await tab.read()).url).toBe("https://b.test/")
  await browser.close()
})

test("type with submit sends the text and Enter in one round trip, text first", async () => {
  let enterBeforeTextAnswered = false
  fake = fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Runtime.evaluate": (m) => {
      const expression = String(m.params.expression)
      if (expression.includes("data-yuki-id")) return { result: { type: "string", value: view("https://a.test/") } }
      return { result: { type: "object", value: { status: "ok", x: 5, y: 5, menu: false } } }
    },
    "Input.insertText": (m, ws, f) => {
      setTimeout(() => {
        enterBeforeTextAnswered = f.sent.some((s) => s.method === "Input.dispatchKeyEvent" && s.params.key === "Enter")
        ws.send(JSON.stringify({ id: m.id, result: {}, sessionId: m.sessionId }))
      }, 30)
      return undefined
    },
  })
  const browser = await connect(fake.url)
  const tab = await browser.openTab()
  await tab.read()
  expect(await tab.act({ op: "type", id: 1, text: "Cloudflare", submit: true })).toEqual({ ok: true })
  const order = fake.sent.filter((s) => s.method.startsWith("Input.")).map((s) => s.method)
  expect(order[0]).toBe("Input.insertText")
  expect(enterBeforeTextAnswered).toBe(true)
  await browser.close()
})

test("a tab opened at a url is created there and waits for its load, with no second navigation", async () => {
  let loadFired = false
  fake = fakeCdp({
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Runtime.evaluate": (_m, _ws, f) => {
      setTimeout(() => {
        loadFired = true
        f.emit("Page.loadEventFired", { timestamp: 1 }, "S1")
      }, 30)
      return { result: { type: "boolean", value: false } }
    },
  })
  const browser = await connect(fake.url)
  await browser.openTab("https://a.test/")
  expect(loadFired).toBe(true)
  expect(sentTo(fake, "Target.createTarget")[0]?.params.url).toBe("https://a.test/")
  expect(sentTo(fake, "Page.navigate")).toHaveLength(0)
  await browser.close()
})

test("nothing in src brings a tab to the front", () => {
  const root = join(import.meta.dir, "../src")
  const files = readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))
  expect(files.length).toBeGreaterThan(3)
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8")
    expect(source.includes("bringToFront")).toBe(false)
    expect(source.includes("activateTarget")).toBe(false)
  }
})

test("the page script is valid JavaScript", () => {
  expect(() => new Function(`return ${READ_SCRIPT}`)).not.toThrow()
})
