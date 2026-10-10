// The step-time lever: four fixed tasks through connect() + runTasks on one Kernel browser, no server.
// Usage: bun packages/browser/scripts/bench.ts [--runs 3] [--decider model|jev|both]
// Keys come from the environment or apps/server/.dev.vars. They are never printed.
// The port adapters send the same requests as apps/server/src/agent/browser/deciders.ts.
import { readFileSync } from "node:fs"
import { connect } from "../src/cdp/browser"
import { escalating } from "../src/decide/escalate"
import { jevDecider } from "../src/decide/jev"
import { modelDecider } from "../src/decide/model"
import type { JevPort, ModelPort } from "../src/decide/ports"
import type { Choice, Decider } from "../src/decide/types"
import type { PageView, Tab } from "../src/page/types"
import { runTask } from "../src/worker/run"
/** Every fast-path pick the worker could make on a page it read, to judge by hand: a wrong one rejects the rule. */
const fastSeen = new Set<string>()
import type { Task, TaskResult } from "../src/worker/types"

const dev = (() => {
  try {
    return readFileSync(new URL("../../../apps/server/.dev.vars", import.meta.url), "utf8")
  } catch {
    return ""
  }
})()
const key = (name: string) => process.env[name] ?? dev.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim()
const KERNEL = key("KERNEL_API_KEY")
const JEV_KEY = key("TYPESAFE_API_KEY")
const MODEL_KEY = key("OPENCODE_API_KEY")
if (!KERNEL) throw new Error("no KERNEL_API_KEY")

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const RUNS = Number(arg("runs", "3"))
const WHICH = arg("decider", "both")
/** Same as DECIDER_MAX_TOKENS and reasoning "minimal" in the server's modelPort. Overridable to try settings. */
const MAX_TOKENS = Number(arg("max-tokens", "1024"))
const REASONING = arg("reasoning", "minimal")
const AT_URL = !process.argv.includes("--blank")

// ---- CDP round trips: a round trip starts when a tab's session goes from zero commands in flight to one.
const inflight = new Map<string, number>()
const owner = new Map<number, string>()
const trips = new Map<string, number>()
/** targetId to sessionId, from Target.attachToTarget replies. */
const sessionOfTarget = new Map<string, string>()
const attachFor = new Map<number, string>()
const Native = globalThis.WebSocket
class CountingSocket extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    this.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : ""
      const m = /^\{"id":(\d+),/.exec(raw)
      if (!m) return
      const id = Number(m[1])
      const target = attachFor.get(id)
      if (target) {
        attachFor.delete(id)
        const sid = /"sessionId":"([^"]+)"/.exec(raw)?.[1]
        if (sid) sessionOfTarget.set(target, sid)
      }
      const s = owner.get(id)
      if (s === undefined) return
      owner.delete(id)
      inflight.set(s, (inflight.get(s) ?? 1) - 1)
    })
  }
  override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data === "string") {
      const msg = JSON.parse(data) as { id: number; method: string; params?: { targetId?: string }; sessionId?: string }
      if (msg.method === "Target.attachToTarget" && msg.params?.targetId) attachFor.set(msg.id, msg.params.targetId)
      const s = msg.sessionId ?? "browser"
      owner.set(msg.id, s)
      const n = inflight.get(s) ?? 0
      if (n === 0) trips.set(s, (trips.get(s) ?? 0) + 1)
      inflight.set(s, n + 1)
    }
    super.send(data)
  }
}
globalThis.WebSocket = CountingSocket as typeof WebSocket

// ---- Ports, matching the server's.
let lastTokens = 0
const tokens: number[] = []
const outTokens: number[] = []
const cached: number[] = []

const jevPort: JevPort = {
  async choose(req, signal) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${JEV_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: req.state,
        questions: { step: { type: "choice", instructions: req.instructions, criteria: Object.fromEntries(req.options.map((o) => [o.key, o.text])) } },
      }),
      signal,
    })
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as {
      answers: { step: { choice: string; confidence: number; probabilities?: Record<string, number> } }
      usage?: { input_tokens?: number; input?: number }
    }
    lastTokens = json.usage?.input_tokens ?? json.usage?.input ?? 0
    tokens.push(lastTokens)
    const a = json.answers.step
    return { key: a.choice, confidence: a.confidence, probabilities: a.probabilities ?? {} }
  },
}

const empties: string[] = []
let modelCalls = 0
const modelPort = (session: string): ModelPort => ({
  async complete(system, user, signal) {
    modelCalls++
    const res = await fetch("https://opencode.ai/zen/go/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${MODEL_KEY}`, "Content-Type": "application/json", "x-opencode-session": session },
      body: JSON.stringify({
        model: "muse-spark-1.3-contributor",
        input: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
        stream: true,
        prompt_cache_key: session,
        store: false,
        max_output_tokens: MAX_TOKENS,
        ...(REASONING === "omit" ? {} : { reasoning: { effort: REASONING, summary: "auto" }, include: ["reasoning.encrypted_content"] }),
      }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`)
    let text = ""
    let why = ""
    let buf = ""
    const decoder = new TextDecoder()
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true })
      let cut = buf.indexOf("\n\n")
      while (cut >= 0) {
        const block = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        cut = buf.indexOf("\n\n")
        const data = block.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
        if (!data || data === "[DONE]") continue
        const ev = JSON.parse(data) as {
          type: string
          delta?: string
          response?: { status?: string; incomplete_details?: { reason?: string }; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }
        }
        if (ev.response?.usage) why = `${ev.response.status} ${ev.response.incomplete_details?.reason ?? ""} out=${ev.response.usage.output_tokens}`
        if (ev.type === "response.output_text.delta") text += ev.delta ?? ""
        if (ev.type === "response.completed" || ev.type === "response.incomplete") {
          lastTokens = ev.response?.usage?.input_tokens ?? 0
          tokens.push(lastTokens)
          outTokens.push(ev.response?.usage?.output_tokens ?? 0)
          cached.push(ev.response?.usage?.input_tokens_details?.cached_tokens ?? 0)
        }
        if (ev.type === "error" || ev.type === "response.failed") throw new Error(`model stream: ${data.slice(0, 200)}`)
      }
    }
    if (!text.trim()) empties.push(`${why} | ${ev0(user)}`)
    return text
  },
})
const ev0 = (user: string) => user.split("\n")[0]?.slice(0, 60) ?? ""

// ---- The tasks, as the main model hands them to browser_run.
// Success is the server suite's: the answer is on the last page the worker leaves, which browser_run reads and ranks.
type Bench = { task: Task; ok: (r: TaskResult, page: PageView) => boolean }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
let topTitles: string[] = []
const BENCH: Bench[] = [
  {
    task: { url: "https://news.ycombinator.com/newest", goal: "find the title of the top story" },
    ok: (r, p) => r.stop !== "crashed" && topTitles.some((t) => norm(`${p.title} ${p.text}`).includes(norm(t))),
  },
  {
    task: { url: "https://en.wikipedia.org", goal: "search for Cloudflare with the search box and find the year Cloudflare was founded", values: { query: "Cloudflare" } },
    ok: (r, p) => r.stop !== "crashed" && /\b2009\b/.test(p.text),
  },
  {
    task: { url: "https://example.com", goal: "find the main heading" },
    ok: (r, p) => r.stop !== "crashed" && /Example Domain/.test(`${p.title} ${p.text}`),
  },
  {
    task: {
      url: "https://httpbin.org/forms/post",
      goal: "fill the pizza order form with the customer name, telephone and email, pick a medium size and the bacon topping, and submit the order",
      values: { name: "Ada Lovelace", telephone: "555-0100", email: "ada@example.com" },
    },
    // httpbin echoes the posted form as JSON.
    ok: (r, p) =>
      r.stop !== "crashed" &&
      [/"custname": "Ada Lovelace"/, /"custtel": "555-0100"/, /"custemail": "ada@example.com"/, /"size": "medium"/, /"topping": "bacon"/].every((re) => re.test(p.text)),
  },
]
const NAMES = ["hn", "wiki", "example", "form"]
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const newest = await (await fetch("https://news.ycombinator.com/newest")).text()
topTitles = [...newest.matchAll(/<span class="titleline"><a [^>]*>([^<]+)<\/a>/g)].slice(0, 10).map((m) => decode(m[1] ?? ""))

// ---- A decider with no model, for the CDP cost alone: a fixed path per task, mixing navigations and in-page steps.
function scriptDecider(): Decider {
  const done = new Map<string, number>()
  return {
    name: "script",
    async decide(input) {
      const n = done.get(input.goal) ?? 0
      done.set(input.goal, n + 1)
      const by = (test: (text: string, key: string) => boolean) => input.options.find((o) => test(o.text, o.key))
      const stop = by((_, k) => k === "done") as Choice
      let pick: Choice | undefined
      if (input.goal.startsWith("find the title")) pick = n === 0 ? by((t) => /click link "past"/.test(t)) : n === 1 ? by((t) => /click link "new"/.test(t)) : stop
      else if (input.goal.startsWith("search")) pick = by((_, k) => /^t\d+v0$/.test(k)) ?? (n < 2 ? by((t) => /click (link|button) "Search"/.test(t)) : stop)
      else pick = n < 2 ? by((_, k) => k === "sd") : stop
      if (input.goal.startsWith("search") && input.page.url.includes("/wiki/Cloudflare")) pick = stop
      return { choice: pick ?? stop, confidence: null, runnersUp: [] }
    },
  }
}

// ---- Per-step stamps, the same cut as the server's timedTab: read before a decision to read after its action.
type Sample = { step: number; decide: number; act: number; read: number; rtt: number }
const samples: Sample[] = []
/** From opening the tab to the worker's first read, per task. */
const starts: number[] = []

function timed(tab: Tab, sessionOf: () => string, opening: number): Tab {
  let since = 0
  let acted = false
  let actMs = 0
  let tripsAt = 0
  let decideAt = 0
  let first = true
  return {
    id: tab.id,
    screenshot: () => tab.screenshot(),
    close: () => tab.close(),
    act: async (step) => {
      if (step.op === "goto") return tab.act(step)
      acted = true
      decideAt = performance.now()
      const result = await tab.act(step)
      actMs = performance.now() - decideAt
      return result
    },
    read: async () => {
      const readAt = performance.now()
      const page = await tab.read()
      const now = performance.now()
      const t = trips.get(sessionOf()) ?? 0
      if (first) starts.push(now - opening)
      first = false
      if (acted && since) samples.push({ step: now - since, decide: decideAt - since, act: actMs, read: now - readAt, rtt: t - tripsAt })
      acted = false
      since = now
      tripsAt = t
      return page
    },
  }
}

const API = "https://api.onkernel.com"
const headers = { Authorization: `Bearer ${KERNEL}`, "Content-Type": "application/json" }
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] as number
}

async function pass(name: string, cdpUrl: string, make: (run: number) => Decider) {
  samples.length = 0
  starts.length = 0
  tokens.length = 0
  outTokens.length = 0
  cached.length = 0
  empties.length = 0
  modelCalls = 0
  let okCount = 0
  const perTask = BENCH.map(() => ({ ok: 0, walls: [] as number[], decisions: 0, decideMs: [] as number[] }))
  const decisionsPerTask: number[] = []
  const walls: number[] = []
  const failures: string[] = []
  for (let run = 0; run < RUNS; run++) {
    let phase = "connect"
    const session = await connect(cdpUrl)
    try {
      // The server's browser_run: one tab per task, at the task's url (with --blank: blank, then the worker's goto).
      const opening = performance.now()
      const raw = await Promise.all(BENCH.map((b) => session.openTab(AT_URL ? b.task.url : undefined)))
      const tabs = raw.map((t) => timed(t, () => sessionOfTarget.get(t.id) ?? "", opening))
      let decisions = 0
      const base = make(run)
      const deciderFor = (i: number): Decider => ({
        name: base.name,
        decide: async (input, signal) => {
          decisions++
          perTask[i]!.decisions++
          const at = performance.now()
          const out = await base.decide(input, signal)
          perTask[i]!.decideMs.push(Math.round(performance.now() - at))
          return out
        },
      })
      phase = "run"
      const t0 = performance.now()
      // runTasks, one task per worker, with a stopwatch per task.
      const signal = AbortSignal.timeout(120_000)
      const results = await Promise.all(
        BENCH.map(async (b, i) => {
          const at = performance.now()
          const r = await runTask(tabs[i]!, b.task, {
            decider: deciderFor(i),
            paused: () => false,
            signal,
            opened: AT_URL,
            onFast: (picks, page) => fastSeen.add(`${b.task.url} @ ${page.url}: ${picks.map((c) => c.text).join(" | ")}`),
          })
          perTask[i]!.walls.push(performance.now() - at)
          return r
        }),
      )
      const wall = performance.now() - t0
      decisionsPerTask.push(decisions / BENCH.length)
      walls.push(performance.now() - opening)
      phase = "final read"
      for (const [i, r] of results.entries()) {
        phase = `final read ${i}`
        const page = await raw[i]!.read()
        const good = BENCH[i]!.ok(r, page)
        if (good) {
          okCount++
          perTask[i]!.ok++
        }
        else failures.push(`run ${run} task ${i}: ${r.stop} ${r.note ?? ""} ${r.actions.join(" | ")} @ ${page.url} options: ${(r.options ?? []).join(" ; ")}`.slice(-400))
      }
      console.log(`  ${name} run ${run}: ${(wall / 1000).toFixed(1)} s, ${results.map((r) => `${r.stop}(${r.actions.length})`).join(" ")}`)
      if (process.argv.includes("--verbose")) for (const r of results) console.log(`    ${r.actions.join(" | ")} @ ${r.url}`)
      await Promise.all(raw.map((t) => t.close()))
    } catch (e) {
      failures.push(`run ${run} threw in ${phase}: ${String(e).slice(0, 200)}`)
      console.log(`  ${name} run ${run} threw in ${phase}: ${String(e).slice(0, 200)}`)
    } finally {
      await session.close()
    }
  }
  const col = (k: keyof Sample) => samples.map((s) => s[k])
  const row = {
    decider: name,
    success: `${okCount}/${RUNS * BENCH.length}`,
    steps: samples.length,
    p50_step: Math.round(pct(col("step"), 0.5)),
    p95_step: Math.round(pct(col("step"), 0.95)),
    p50_decide: Math.round(pct(col("decide"), 0.5)),
    p50_act: Math.round(pct(col("act"), 0.5)),
    p50_read: Math.round(pct(col("read"), 0.5)),
    rtt_per_step: +(col("rtt").reduce((a, b) => a + b, 0) / (samples.length || 1)).toFixed(2),
    decisions_per_task: +(decisionsPerTask.reduce((a, b) => a + b, 0) / (decisionsPerTask.length || 1)).toFixed(2),
    tokens_per_decision: Math.round(tokens.reduce((a, b) => a + b, 0) / (tokens.length || 1)),
    p50_out_tokens: pct(outTokens, 0.5),
    cached_per_decision: Math.round(cached.reduce((a, b) => a + b, 0) / (cached.length || 1)),
    p50_start: Math.round(pct(starts, 0.5)),
    p50_run_wall: Math.round(pct(walls, 0.5)),
    empty_rate: modelCalls ? `${empties.length}/${modelCalls}` : "-",
    ...Object.fromEntries(
      perTask.flatMap((t, i) => [
        [`${NAMES[i]}_ok`, `${t.ok}/${RUNS}`],
        [`${NAMES[i]}_wall`, Math.round(pct(t.walls, 0.5))],
        [`${NAMES[i]}_dec`, +(t.decisions / RUNS).toFixed(1)],
      ]),
    ),
  }
  for (const f of failures) console.log(`  FAIL ${f}`)
  for (const f of fastSeen) console.log(`  FAST ${f}`)
  for (const [i, t] of perTask.entries()) console.log(`  decide ms ${NAMES[i]}: ${t.decideMs.join(" ")}`)
  fastSeen.clear()
  if (empties.length) console.log(`  empty model answers: ${empties.length}: ${[...new Set(empties)].slice(0, 4).join("; ")}`)
  return row
}

const created = await fetch(`${API}/browsers`, { method: "POST", headers, body: JSON.stringify({ headless: true, timeout_seconds: 600 }) })
if (!created.ok) throw new Error(`Kernel create failed: ${created.status} ${(await created.text()).slice(0, 200)}`)
const browser = (await created.json()) as { session_id: string; cdp_ws_url: string }
const rows: Record<string, unknown>[] = []
try {
  if ((WHICH === "both" || WHICH === "model") && MODEL_KEY)
    rows.push(await pass("model", browser.cdp_ws_url, (run) => modelDecider(modelPort(`bench-${Date.now().toString(36)}-${run}`))))
  if ((WHICH === "both" || WHICH === "jev") && JEV_KEY) rows.push(await pass("jev", browser.cdp_ws_url, (run) => (MODEL_KEY ? escalating(jevDecider(jevPort), modelDecider(modelPort(`bench-jev-${Date.now().toString(36)}-${run}`))) : jevDecider(jevPort))))
  if (WHICH === "script") rows.push(await pass("script", browser.cdp_ws_url, () => scriptDecider()))
} finally {
  const gone = await fetch(`${API}/browsers/${browser.session_id}`, { method: "DELETE", headers })
  console.log(`kernel delete: ${gone.status}`)
}
console.log(`\n${Object.keys(rows[0] ?? {}).join("\t")}`)
for (const r of rows) console.log(Object.values(r).join("\t"))
