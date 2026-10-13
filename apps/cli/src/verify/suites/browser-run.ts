import { VerifyError } from "../client"
import { browserRoom, browserUser, closeBrowser, mainTurns, p50, stepSamples, turn } from "../browser-kit"
import type { Suite } from "../runner"
import { dev } from "../routine-kit"
import { readStats, resetStats } from "./latency"


const ASK = [
  "Use one browser_run call with three tasks at once:",
  "1. start at https://news.ycombinator.com/newest and find the title of the top story;",
  "2. start at https://en.wikipedia.org, search for Cloudflare with the search box, and find the year Cloudflare was founded;",
  "3. start at https://example.com and find the main heading.",
  "Then answer with the three results, one line each.",
].join(" ")

const LIMITS = { model: 2_500, jev: 1_200 } as const
const JEV_TOKENS = 1_500

async function newestTitles(): Promise<string[]> {
  const html = await (await fetch("https://news.ycombinator.com/newest", { signal: AbortSignal.timeout(15_000) })).text()
  return [...html.matchAll(/<span class="titleline"><a [^>]*>([^<]+)<\/a>/g)].slice(0, 10).map((m) => m[1] ?? "")
}

const norm = (s: string) => s.toLowerCase().replace(/&#x27;|&amp;|&quot;/g, " ").replace(/[^a-z0-9]+/g, " ").trim()

const suite: Suite = {
  name: "browser-run",
  model: true,
  human: true,
  async run(v) {
    const only = process.env.KIKO_BROWSER_DECIDER
    const passes = (["model", "jev"] as const).filter((d) => !only || only === d)
    const failures: string[] = []
    for (const decider of passes) {
      const s = await browserUser(v, `browser-run-${decider}-${Date.now().toString(36)}`, decider === "jev")
      try {
        const { room, roomId } = await browserRoom(s, `browser run ${decider}`)
        await turn(room, "hi")
        await resetStats(v, s)
        const titles = await newestTitles()
        const { text, total } = await turn(room, ASK, 170_000)
        const c = await readStats(v, s)
        const trace = (await dev(v.url, s, "trace", { roomId })) as { kind: string; tool?: string; text?: string }[]
        for (const e of trace.filter((x) => x.text && /^<untrusted/.test(x.text))) console.log(`  [${decider}] worker result: ${(e.text ?? "").replace(/\s+/g, " ").slice(0, 1200)}`)
        const steps = stepSamples(c)
        const used = c["browser.decider.jev"] ? "jev" : c["browser.decider.model"] ? "model" : "none"
        const main = mainTurns(c)
        const jevPer = c["browser.jev.calls"] ? Math.round((c["browser.jev.input"] ?? 0) / c["browser.jev.calls"]) : 0
        const found = {
          hn: titles.some((t) => norm(text).includes(norm(t))),
          wikipedia: /\b2009\b/.test(text),
          example: /example domain/i.test(text),
        }
        console.log(`  [${decider}] reply: ${text.slice(0, 300)}`)
        console.log(`  [${decider}] time ${(total / 1000).toFixed(1)} s, browser_run calls ${c["browser.browser_run.calls"] ?? 0}, decider ${used}, steps ${steps.length}, p50 step ${p50(steps)} ms, mean decide ${c["browser.decider.calls"] || c["browser.jev.calls"] ? Math.round((c["browser.decide.ms"] ?? 0) / ((c["browser.decider.calls"] ?? 0) + (c["browser.jev.calls"] ?? 0) || 1)) : 0} ms`)
        console.log(`  [${decider}] main-model turns ${main} (${(main / 3).toFixed(2)} per task), decider model calls ${c["browser.decider.calls"] ?? 0}, jev calls ${c["browser.jev.calls"] ?? 0}, jev input tokens a decision ${jevPer}`)
        const mean = (k: string) => (c["browser.steps"] ? Math.round((c[k] ?? 0) / c["browser.steps"]) : 0)
        console.log(`  [${decider}] per step: act ${mean("browser.act.ms")} ms, read ${mean("browser.stepread.ms")} ms, whole ${mean("browser.step.ms")} ms`)
        console.log(`  [${decider}] found: ${Object.entries(found).map(([k, ok]) => `${k} ${ok ? "yes" : "NO"}`).join(", ")}`)
        const fail = (why: string) => failures.push(`${decider}: ${why}`)
        if (!c["browser.browser_run.calls"]) fail("browser_run was not called")
        if (used !== decider) fail(`the decider was ${used}`)
        if (Object.values(found).some((ok) => !ok)) fail("not every task's answer is in the reply")
        if (p50(steps) > LIMITS[decider]) fail(`p50 step ${p50(steps)} ms is over ${LIMITS[decider]} ms`)
        if (main / 3 > 2) fail(`${main} main-model turns for 3 tasks`)
        if (decider === "jev" && jevPer > JEV_TOKENS) fail(`${jevPer} Jev input tokens a decision`)
      } finally {
        await closeBrowser(v, s)
      }
    }
    if (failures.length) throw new VerifyError(failures.join("; "))
  },
}

export default suite
