import { connect } from "../src/cdp/browser"
import { openSession } from "../src/cdp/session"
import { READ_SCRIPT } from "../src/page/script"
import type { PageView, Tab } from "../src/page/types"

const API = "https://api.onkernel.com"
const key = process.env.KERNEL_API_KEY
if (!key) throw new Error("Set KERNEL_API_KEY")
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

const timings: [string, number][] = []
async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const out = await run()
  timings.push([name, performance.now() - start])
  return out
}
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

function find(view: PageView, test: (label: string, role: string) => boolean) {
  const hit = view.controls.find((c) => test(c.label, c.role))
  if (!hit) throw new Error(`No matching control on ${view.url}`)
  return hit
}

async function reads(tab: Tab, name: string, count: number) {
  const ms: number[] = []
  let view: PageView | undefined
  for (let i = 0; i < count; i++) {
    const start = performance.now()
    view = await tab.read()
    ms.push(performance.now() - start)
  }
  timings.push([`${name} read p50 (${count})`, p50(ms)])
  return view as PageView
}

const created = await fetch(`${API}/browsers`, { method: "POST", headers, body: JSON.stringify({ headless: true, timeout_seconds: 120 }) })
if (!created.ok) throw new Error(`Kernel create failed: ${created.status} ${await created.text()}`)
const browser = (await created.json()) as { session_id: string; cdp_ws_url: string }

try {
  const session = await timed("connect", () => connect(browser.cdp_ws_url))
  const [hn, wiki] = await timed("openTab x2 (parallel, with load)", () =>
    Promise.all([session.openTab("https://news.ycombinator.com"), session.openTab("https://en.wikipedia.org/wiki/Cloudflare")]),
  )

  const hnView = await reads(hn, "HN", 5)
  const wikiView = await reads(wiki, "Wikipedia", 5)
  const side = await openSession(browser.cdp_ws_url)
  const { sessionId } = await side.send("Target.attachToTarget", { targetId: hn.id, flatten: true })
  const tab = side.channel(sessionId)
  const rtt: number[] = []
  const inPage: number[] = []
  let wire = 0
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    await side.send("Browser.getVersion")
    rtt.push(performance.now() - start)
    const timedInPage = `(async () => { const t = performance.now(); await ${READ_SCRIPT}; return performance.now() - t })()`
    const out = await tab.send("Runtime.evaluate", { expression: timedInPage, returnByValue: true, awaitPromise: true })
    inPage.push(out.result.value as number)
  }
  const sized = await tab.send("Runtime.evaluate", { expression: `(async () => (await ${READ_SCRIPT}).length)()`, returnByValue: true, awaitPromise: true })
  wire = sized.result.value as number
  timings.push(["CDP round trip p50 (5)", p50(rtt)], ["HN read script in page p50 (5)", p50(inPage)])
  console.log(`HN read: ${JSON.stringify(hnView).length} bytes as JSON, ${wire} bytes on the wire`)
  await side.close()

  console.log(`HN: ${hnView.controls.length} controls, ${hnView.omitted} omitted, ${hnView.text.length} chars, key ${hnView.key}`)
  console.log("HN sample:", JSON.stringify(hnView.controls.filter((c) => c.hint).slice(8, 14)))
  console.log(`Wikipedia: ${wikiView.controls.length} controls, ${wikiView.omitted} omitted, ${wikiView.text.length} chars`)

  const newLink = find(hnView, (label, role) => label === "new" && role === "link")
  const clicked = await timed("act click HN 'new'", () => hn.act({ op: "click", id: newLink.id }))
  const after = await hn.read()
  console.log("click:", JSON.stringify(clicked), "->", after.url)
  if (!after.url.includes("/newest")) throw new Error("The click on 'new' did not land")

  const stale = await hn.act({ op: "click", id: 999_999 })
  console.log("unknown id:", JSON.stringify(stale))

  const isSearch = (label: string, role: string) => role === "searchbox" || /search wikipedia/i.test(label)
  let wikiNow = wikiView
  if (!wikiNow.controls.some((c) => isSearch(c.label, c.role))) {
    // Narrow viewports collapse Wikipedia's search box behind a "Search" link.
    const opener = find(wikiNow, (label) => label === "Search")
    const opened = await timed("act click Wikipedia 'Search'", () => wiki.act({ op: "click", id: opener.id }))
    console.log("open search:", JSON.stringify(opened))
    wikiNow = await wiki.read()
  }
  const typeInto = (view: PageView) =>
    wiki.act({ op: "type", id: find(view, isSearch).id, text: "Durable Objects", submit: true })
  let typed = await timed("act type + Enter (Wikipedia)", () => typeInto(wikiNow))
  if (!typed.ok && (typed.reason === "gone" || typed.reason === "stale")) {
    console.log("type refused:", JSON.stringify(typed), "- reading again")
    const fresh = await wiki.read()
    // Wikipedia swaps its search input for a script-built one; the guard refuses, so read and retry.
    typed = await timed("act type + Enter, retry", () => typeInto(fresh))
  }
  const results = await wiki.read()
  console.log("type:", JSON.stringify(typed), "->", results.url, `"${results.title}"`)
  if (!/search=Durable|Durable_Object/i.test(results.url)) throw new Error("The search did not land")

  const shot = await timed("screenshot (just after navigation)", () => wiki.screenshot())
  await timed("screenshot (settled)", () => wiki.screenshot())
  console.log(`screenshot: ${shot.length} bytes, jpeg=${shot[0] === 0xff && shot[1] === 0xd8}`)
  await session.close()
  await session.closed

  console.log("\n| step | ms |\n|---|---|")
  for (const [name, ms] of timings) console.log(`| ${name} | ${ms.toFixed(0)} |`)
} finally {
  const gone = await fetch(`${API}/browsers/${browser.session_id}`, { method: "DELETE", headers })
  console.log(`\ndelete: ${gone.status}`)
  const active = await fetch(`${API}/browsers?status=active`, { headers })
  console.log(`active browsers: ${await active.text()}`)
}
