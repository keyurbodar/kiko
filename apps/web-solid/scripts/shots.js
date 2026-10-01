const { mkdir } = await import("node:fs/promises")
await mkdir(OUT, { recursive: true })

const task = await taskSpace("kiko shots " + LABEL)
const page = task.page("p1")
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
})
await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source:
    "window.__errs = [];" +
    "window.addEventListener('error', (e) => window.__errs.push('error: ' + (e.message || String(e.error))));" +
    "window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason)));",
})

const base = "http://localhost:" + PORT
const report = {}

const settle = async () => {
  await page.evaluate(
    () =>
      Promise.all(
        [...document.images].map((img) =>
          img.complete ? null : new Promise((done) => {
            img.onload = done
            img.onerror = done
            setTimeout(done, 3000)
          }),
        ),
      ),
  )
  await page.waitForTimeout(250)
}

await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForSelector("loc=css:[data-component=chat-shell]", { timeout: 30000 })
await settle()
await page.screenshot({ path: OUT + "/app.png" })
report.app = await page.evaluate(() => window.__errs)

await page.goto(base + "/src/chat/harness.html", { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForFunction(() => typeof window.__chat === "object", undefined, { timeout: 30000 })
const states = STATES.length > 0 ? STATES : await page.evaluate(() => window.__chat.states())

for (const state of states) {
  await page.evaluate((slug) => window.__chat.setState(slug), state)
  await settle()
  await page.screenshot({ path: OUT + "/" + state + ".png" })
  report[state] = await page.evaluate(() => window.__errs.splice(0))
}

const errors = Object.entries(report).filter(([, list]) => list.length > 0)
console.log(JSON.stringify({ out: OUT, shots: states.length + 1, errors }))
await task.finish({ keep: [] })
