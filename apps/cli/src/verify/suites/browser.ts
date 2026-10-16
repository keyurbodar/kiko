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
    const s = await browserUser(v, USER, false)
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

    for (;;) {
      const state = await api<{ status: { browser: { tabs: Record<string, number> } | null } }>(v.url, s, "dev/agent/browser", { action: "state" })
      const held = Object.keys(state.json.status.browser?.tabs ?? {}).some((k) => k.startsWith(`${roomId}:`))
      if (!held) {
        console.log(`  socket closed ${((performance.now() - done) / 1000).toFixed(1)} s after the reply`)
        break
      }
      if (performance.now() - done > 40_000) throw new VerifyError("the browser socket did not close within 40 s")
      await Bun.sleep(1_000)
    }
}

export default suite
