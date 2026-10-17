import { type Session, type Verifier, VerifyError } from "../client"
import { activeBrowsers, browserRoom, browserUser, closeBrowser, mainTurns, turn } from "../browser-kit"
import { fakeBrowserRun } from "../browser-fake"
import type { Suite } from "../runner"
import { api } from "../routine-kit"
import { readStats, resetStats } from "./latency"


const USER = `browser-${Date.now().toString(36)}`
const ASK = "Use the browse tool (not web_fetch): what is the title of the top story on Hacker News right now? Answer with just the title."
const LIMIT_MS = 20_000

async function topTitle(): Promise<string> {
  const html = await (await fetch("https://news.ycombinator.com", { signal: AbortSignal.timeout(15_000) })).text()
  const m = /<span class="titleline"><a [^>]*>([^<]+)<\/a>/.exec(html)
  if (!m) throw new VerifyError("could not read the top title from news.ycombinator.com")
  return (m[1] ?? "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

const suite: Suite = {
  name: "browser",
  model: true,
  human: true,
  async run(v) {
    if (v.fake) return fakeBrowserRun(v)
    if ((await activeBrowsers()).length) console.log("  note: Kernel already lists active browsers on this key")
    const s = await browserUser(v, USER)
    try {
      await check(v, s)
    } finally {
      await closeBrowser(v, s)
    }
  },
}

async function check(v: Verifier, s: Session): Promise<void> {
    const { room, roomId } = await browserRoom(s, "browser hn")
    await turn(room, "hi")

    const before = await topTitle()
    await resetStats(v, s)
    const { text, total } = await turn(room, ASK)
    const after = await topTitle()
    const done = performance.now()
    const c = await readStats(v, s)

    const tools = Object.keys(c).filter((k) => /^browser\.[a-z_]+\.calls$/.test(k)).map((k) => `${k.split(".")[1]}×${c[k]}`)
    console.log(`  reply: ${text.slice(0, 200)}`)
    console.log(`  counters: ${Object.entries(c).filter(([k]) => /^(browser\.|model\.)/.test(k)).map(([k, n]) => `${k}=${n}`).join(" ")}`)
    console.log(`  expected: ${before}${after !== before ? ` (or ${after})` : ""}`)
    console.log(`  time: ${(total / 1000).toFixed(1)} s, browser tools: ${tools.join(" ") || "none"}, main-model turns: ${mainTurns(c)}`)
    if (!tools.length) throw new VerifyError("the agent used no browser tool")
    if (c["browser.browser_look.calls"]) throw new VerifyError("the agent took a screenshot")
    if (![before, after].some((t) => norm(text).includes(norm(t)))) throw new VerifyError("the reply does not name the top story")
    if (total > LIMIT_MS) throw new VerifyError(`the answer took ${(total / 1000).toFixed(1)} s, over ${LIMIT_MS / 1000} s`)

    const shown = await turn(room, "Send me the link to watch the browser live.")
    console.log(`  link reply: ${shown.text.slice(0, 200)}`)
    if (!/\]\(https:\/\/[^)\s]*kernel[^)\s]*\)/.test(shown.text)) throw new VerifyError("the agent did not send the live view as a markdown link")

    // The run ended, so its tabs are gone from the lease and the chip has nothing to show. The browser itself stays.
    for (;;) {
      const state = await api<{ status: { browser: { tabs: Record<string, number> } | null } }>(v.url, s, "dev/agent/browser", { action: "state" })
      const held = Object.entries(state.json.status.browser?.tabs ?? {}).filter(([k, n]) => k.startsWith(`${roomId}:`) && n > 0)
      if (!held.length) {
        console.log(`  the run's tabs were released ${((performance.now() - done) / 1000).toFixed(1)} s after the reply, so the chip hides`)
        break
      }
      if (performance.now() - done > 30_000) throw new VerifyError("the run's end did not release its tabs")
      await Bun.sleep(1_000)
    }
    if (((await readStats(v, s))["browser.idle.closed"] ?? 0) < 1) console.log("  note: the idle socket close has not run yet; it closes 15 s after the last call")
}

export default suite
