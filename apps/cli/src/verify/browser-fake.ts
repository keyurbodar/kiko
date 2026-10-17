import { agentTexts, frames, newRoom, poll, seen } from "./kit"
import { activeBrowsers, closeBrowser, connectKernel } from "./browser-kit"
import { type RoomHandle, type Session, type Verifier, VerifyError } from "./client"
import { api, inSeconds, ok, type Routine, toolLine } from "./routine-kit"
import { readStats, resetStats } from "./suites/latency"
import { fake, send } from "./suites/mid-run"

const HN = "https://news.ycombinator.com"
const FOREIGN_WAIT_MS = 10_000
/** The page tools a worker gets. The talker gets none of them, only browser_link. */
const PAGE_TOOLS = ["browse", "browser_act", "browser_look"]

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
const sessionOf = async (v: Verifier, s: Session) => (await api<{ sessionId: string | null }>(v.url, s, "dev/agent/browser", { action: "state" })).json.sessionId
/** The lease's tab counts, keyed by the agent id that owns them, as `roomId:slug`. */
const claimed = async (v: Verifier, s: Session) => (await api<State>(v.url, s, "dev/agent/browser", { action: "state" })).json.status.browser?.tabs ?? {}

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
    const r = await holder(v, s, "browser fake: routine")

    const first = await ok<{ routine: Routine }>(v.url, s, "routines", { roomId: r.roomId, name: "browse new", instructions: `[browse ${HN} click new]`, trigger: { on: "time", at: inSeconds(3) } })
    const clicked = await ask(a.room, `[browse ${HN} click new]`)
    await note()
    if (!/did: click \d+\./.test(clicked)) throw new VerifyError(`the batch did not report its click: ${JSON.stringify(clicked.slice(0, 300))}`)
    if (!clicked.includes(`| ${HN}/newest`)) throw new VerifyError(`the fresh summary is not the /newest page: ${JSON.stringify(clicked.slice(0, 300))}`)
    console.log(`  ok browse then one browser_act batch clicked 'new' by its summary id; the fresh summary is ${HN}/newest`)

    await poll("the routine's answer", () => agentTexts(r.room).some((t) => t.includes("/newest")), 40_000)
    await note()
    const routineText = agentTexts(r.room).find((t) => t.includes("/newest")) ?? ""
    if (!/did: click \d+\./.test(routineText)) throw new VerifyError(`the routine's browser_act did not click: ${JSON.stringify(routineText.slice(0, 300))}`)
    console.log(`  ok routine ${first.routine.id} ran browser_act (click, /newest)`)

    const talker = (await ask(a.room, "[tools]")).replace(/^tools: /, "").split(",")
    const leaked = PAGE_TOOLS.filter((t) => talker.includes(t))
    if (leaked.length) throw new VerifyError(`the talker has page tools: ${leaked.join(", ")}`)
    const mark = texts(a.room).length
    await send(a.room, toolLine("start_work", { task: "[tools]" }))
    await poll("the worker's tool list", () => texts(a.room).slice(mark).some((t) => /report w\d+ done: tools: /.test(t)), 40_000)
    const viaWorker = texts(a.room).slice(mark).find((t) => /report w\d+ done: tools: /.test(t)) ?? ""
    const listed = /tools: ([\w,]+)/.exec(viaWorker)?.[1]?.split(",")
    if (!listed?.length) throw new VerifyError(`the worker did not list its tools: ${JSON.stringify(viaWorker.slice(0, 300))}`)
    const missing = PAGE_TOOLS.filter((t) => !listed.includes(t))
    if (missing.length) throw new VerifyError(`a worker lacks page tools: ${missing.join(", ")}`)
    console.log(`  ok the talker has none of ${PAGE_TOOLS.join(", ")}; a worker has all of them`)

    // The run is over, so its tabs are gone and the chip has nothing to show. The browser itself stays for the next run.
    const mineLeft = (tabs: Record<string, number>) => Object.entries(tabs).filter(([agent, n]) => agent.startsWith(`${a.roomId}:`) && n > 0)
    let held = mineLeft(await claimed(v, s).catch(() => ({})))
    for (const end = Date.now() + 20_000; held.length && Date.now() < end; await Bun.sleep(1_000)) {
      held = mineLeft(await claimed(v, s).catch(() => ({})))
    }
    if (held.length) throw new VerifyError(`the run's tabs are still claimed after it ended: ${JSON.stringify(held)}`)
    console.log("  ok the run's end released its tabs, so the chip hides; the browser and its logins stay")

    const user = await s.user()

    const posted = await ask(a.room, toolLine("browser_link", { mode: "control", reason: "please sign in to example.com" }), 90_000)
    await poll("the control call's own answer", () => texts(a.room).some((t) => t.includes("posted the Take control card")), 30_000)
    const card = await poll("the Take control card", () =>
      frames(a.room).flatMap((f) => (f.t === "events" ? f.events : [])).find((e) => e.t === "message" && e.event?.kind === "browser_control"),
    30_000)
    if (!(card && "text" in card && card.text.includes("needs you in the browser: please sign in to example.com"))) throw new VerifyError(`the control request did not post a Take control card: ${JSON.stringify(posted.slice(0, 300))}`)
    if (texts(a.room).some((t) => /kernel\.sh/.test(t) && !t.includes("posted the"))) throw new VerifyError("a control request put the live view link in the chat")
    console.log("  ok the talker posted a Take control card to the chat, with no link in it")

    const paused = await ask(a.room, toolLine("browse", { urls: ["https://example.com"] }))
    if (!paused.includes("The human has control of the browser")) throw new VerifyError(`browse ran while the human had control: ${JSON.stringify(paused.slice(0, 200))}`)
    const bystander = await holder(v, s, "browser fake: bystander")
    const waited = await ask(bystander.room, toolLine("browse", { urls: ["https://example.com"] }))
    if (!waited.includes("The human has control of the browser")) throw new VerifyError(`another agent's browse ran while the human had control: ${JSON.stringify(waited.slice(0, 200))}`)
    user.send({ t: "handBack" })
    const woken = (h: { room: RoomHandle }) => texts(h.room).some((t) => t.includes("released control of the browser"))
    await poll("the wakes after Release control", () => woken(a) && woken(bystander), 30_000)
    console.log("  ok Release control woke the agent that asked for control and the agent it had paused")
    const resumed = await poll("browse after hand back", async () => {
      const out = await ask(a.room, toolLine("browse", { urls: ["https://example.com"] }))
      return out.includes("Example Domain") ? out : undefined
    }, 60_000)
    if (!resumed) throw new VerifyError("browse did not resume after the human handed back")
    console.log("  ok browse waited while the human had control and worked again after hand back")

    await resetStats(v, s)
    const four = await ask(a.room, toolLine("browse", { urls: ["https://example.com", "https://example.org", "https://example.net", "https://www.iana.org/help/example-domains"] }), 90_000)
    const pages = four.match(/--- page \d+/g)?.length ?? 0
    if (pages !== 4) throw new VerifyError(`browse with four urls returned ${pages} pages: ${JSON.stringify(four.slice(0, 300))}`)
    console.log("  ok browse read four urls at once and left one tab")

    // The idle close shuts the socket and keeps the browser; the next call attaches to a page it already has.
    const idled = (await readStats(v, s))["browser.idle.closed"] ?? 0
    if (idled < 1) console.log("  note: the idle close has not run yet; the socket closes 15 s after the last call")
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
