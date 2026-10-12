import { agentTexts, newRoom, poll, seen } from "./kit"
import { activeBrowsers, closeBrowser, connectKernel } from "./browser-kit"
import { type RoomHandle, type Session, type Verifier, VerifyError } from "./client"
import { api, inSeconds, ok, type Routine, toolLine } from "./routine-kit"
import { readStats, resetStats } from "./suites/latency"
import { fake, send } from "./suites/mid-run"

const HN = "https://news.ycombinator.com"
const TABS = 8
const BUSY_MS = 1_000
const FOREIGN_WAIT_MS = 10_000
const TOOLS = ["browse", "browser_act", "browser_run", "browser_look", "browser_share"]

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)

async function ask(room: RoomHandle, text: string, ms = 40_000): Promise<string> {
  const before = texts(room).length
  await send(room, text)
  await poll(`an answer to ${text.slice(0, 40)}`, () => texts(room).length > before, ms)
  return texts(room).at(-1) ?? ""
}

async function holder(v: Verifier, s: Session, title: string): Promise<{ roomId: string; room: RoomHandle }> {
  const opened = await newRoom(s, title)
  await fake(v, s, opened.roomId)
  return opened
}

type State = { status: { browser: { tabs: Record<string, number> } | null } }
const held = (state: { json: State }) => Object.values(state.json.status.browser?.tabs ?? {}).reduce((n, k) => n + k, 0)
const sessionOf = async (v: Verifier, s: Session) => (await api<{ sessionId: string | null }>(v.url, s, "dev/agent/browser", { action: "state" })).json.sessionId

export async function fakeBrowserRun(v: Verifier): Promise<void> {
  const mine = new Set<string>()
  const before = await activeBrowsers()
  if (before.length) console.log(`  note: Kernel already lists ${before.length} active browser(s) on this key`)
  const s = await v.as(`browser-fake-${Date.now().toString(36)}`)
  await connectKernel(s)
  const note = async () => {
    const id = await sessionOf(v, s)
    if (id) mine.add(id)
  }
  try {
    const a = await holder(v, s, "browser fake: hn")
    const others = await Promise.all(Array.from({ length: TABS - 2 }, (_, i) => holder(v, s, `browser fake: tab ${i + 3}`)))
    const ninth = await holder(v, s, "browser fake: ninth")
    const r = await holder(v, s, "browser fake: routine")

    const first = await ok<{ routine: Routine }>(v.url, s, "routines", { roomId: r.roomId, name: "browse new", instructions: `[browse ${HN} click new]`, trigger: { on: "time", at: inSeconds(3) } })
    const [clicked, ...opened] = await Promise.all([ask(a.room, `[browse ${HN} click new]`), ...others.map((h) => ask(h.room, toolLine("browse", { urls: ["https://example.com"] })))])
    await note()
    if (!/did: click \d+\./.test(clicked)) throw new VerifyError(`the batch did not report its click: ${JSON.stringify(clicked.slice(0, 300))}`)
    if (!clicked.endsWith(`| ${HN}/newest`)) throw new VerifyError(`the fresh summary is not the /newest page: ${JSON.stringify(clicked.slice(0, 300))}`)
    console.log(`  ok browse then one browser_act batch clicked 'new' by its summary id; the fresh summary is ${HN}/newest`)

    const bad = opened.findIndex((got) => !got.includes("Example Domain"))
    if (bad >= 0) throw new VerifyError(`tab ${bad + 3} did not open example.com: ${JSON.stringify(opened[bad]?.slice(0, 200))}`)
    await poll("the routine's answer", () => agentTexts(r.room).some((t) => t.includes("/newest")), 40_000)
    await note()
    const tabs = held(await api<State>(v.url, s, "dev/agent/browser", { action: "state" }))
    if (tabs < TABS) throw new VerifyError(`expected ${TABS} open tabs before the ninth, the lease counts ${tabs}`)
    await resetStats(v, s)
    const full = await ask(ninth.room, toolLine("browse", { urls: ["https://example.com"] }))
    const stats = await readStats(v, s)
    const took = stats["browser.browse.ms"] ?? 0
    if (!full.includes(`the browser is full: ${TABS} tabs are open`)) throw new VerifyError(`the ninth tab was not told the browser is full: ${JSON.stringify(full.slice(0, 300))}`)
    const named = (/\((.*)\)/.exec(full)?.[1] ?? "").split(", ").filter((h) => / has \d+$/.test(h))
    if (named.length < 2) throw new VerifyError(`the busy answer does not name the holders: ${JSON.stringify(full.slice(0, 300))}`)
    if (took > BUSY_MS) throw new VerifyError(`the busy answer took ${took} ms, over ${BUSY_MS} ms`)
    console.log(`  ok the ninth tab was refused in ${took} ms: ${full.slice(full.indexOf("the browser is full")).slice(0, 160)}`)

    const talker = (await ask(a.room, "[tools]")).replace(/^tools: /, "").split(",")
    const leaked = TOOLS.filter((t) => talker.includes(t))
    if (leaked.length) throw new VerifyError(`the talker has browser tools: ${leaked.join(", ")}`)
    const mark = texts(a.room).length
    await send(a.room, toolLine("start_work", { task: "[tools]" }))
    await poll("the worker's tool list", () => texts(a.room).slice(mark).some((t) => /report w\d+ done: tools: /.test(t)), 40_000)
    const viaWorker = texts(a.room).slice(mark).find((t) => /report w\d+ done: tools: /.test(t)) ?? ""
    const listed = /tools: ([\w,]+)/.exec(viaWorker)?.[1]?.split(",")
    if (!listed?.length) throw new VerifyError(`the worker did not list its tools: ${JSON.stringify(viaWorker.slice(0, 300))}`)
    const missing = TOOLS.filter((t) => !listed.includes(t))
    if (missing.length) throw new VerifyError(`a worker lacks browser tools: ${missing.join(", ")}`)
    console.log(`  ok the talker has none of ${TOOLS.join(", ")}; a worker has all of them`)

    const routineText = agentTexts(r.room).find((t) => t.includes("/newest")) ?? ""
    if (!/did: click \d+\./.test(routineText)) throw new VerifyError(`the routine's browser_act did not click: ${JSON.stringify(routineText.slice(0, 300))}`)
    console.log(`  ok routine ${first.routine.id} ran browser_act (click, /newest)`)
  } finally {
    await note().catch(() => {})
    await closeBrowser(v, s).catch((e) => console.log(`  cleanup: ${e instanceof Error ? e.message : String(e)}`))
  }

  const start = Date.now()
  const end = start + 60_000
  for (;;) {
    const left = await activeBrowsers()
    const ours = left.filter((id) => mine.has(id))
    if (ours.length) {
      if (Date.now() > end) throw new VerifyError(`Kernel still lists this run's browsers: ${ours.join(", ")}`)
    } else if (!left.length) {
      console.log(`  ok Kernel's active list is empty; this run's browsers ${[...mine].join(", ") || "(none)"} are gone`)
      return
    } else if (Date.now() > start + FOREIGN_WAIT_MS) {
      console.log(`  ok none of this run's browsers (${[...mine].join(", ")}) are active; ${left.length} other(s) on this key are not ours`)
      return
    }
    await Bun.sleep(2_000)
  }
}
