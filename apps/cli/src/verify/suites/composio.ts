import type { ClientToUser, RoomToClient } from "@yuki/protocol"
import { connectTestModel, expectEqual, type RoomHandle, VerifyError } from "../client"
import { dev, inSeconds, ok, runsOf } from "../routine-kit"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { newRoom } from "./mid-run"

// Composio, end to end with a real model. Needs OPENCODE_API_KEY (the model, opencode-go) and
// COMPOSIO_API_KEY (a consumer key, ck_...) in the shell; COMPOSIO_DEVELOPER_KEY (ak_...) is
// optional. Part one: a bad key and a bad developer key are refused and store nothing. Part two:
// connect the real key, ask a fresh chat to search the web through Composio, and prove from the
// server's dev counters (`composio.<tool>.ms`, bumped on every tool call) that a composio_* tool
// ran and that a reply bubble arrived. Part three: the developer key is added after the tool was
// learned, so the server classifies it behind the answer. A second fresh chat asks another web
// question, and must use the learned tool directly, with no search, and the status must report
// that tool as a read (Composio's catalog tags it read-only). Without a developer key it must stay
// external. Part four, only with a developer key: a routine runs in a room whose agent opened
// before anything was learned and is still open. It must reload, call the learned tool, and post
// no approval card, since a routine run's `external` calls need one. Hard limits: 60 s per socket
// answer, 150 s per chat turn or routine run.

const USER = "composio-alice"
const MODEL = process.env.YUKI_COMPOSIO_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
const ASK = "Use Composio to search the web: what is the latest stable Bun version? Answer in one line."
const ASK_AGAIN = "Use Composio to search the web: who maintains the Bun runtime? One line."
const ROUTINE = "Use Composio to search the web: what is the latest stable Deno version? Answer in one line."
const TURN_MS = 150_000

type Result = { ok: true; status: { connected: boolean; rows: number; developer: boolean }; tools?: string[]; readOnly?: string[] } | { ok: false; error: string }
type Events = Extract<RoomToClient, { t: "events" }>
type Status = Extract<RoomToClient, { t: "status" }>

const suite: Suite = {
  name: "composio",
  model: true,
  human: true,
  async run(v) {
    const key = process.env.COMPOSIO_API_KEY
    if (!key) throw new VerifyError("COMPOSIO_API_KEY is not set in this shell")
    const developerKey = process.env.COMPOSIO_DEVELOPER_KEY
    const s = await v.as(USER)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const ask = async (frame: Record<string, unknown>): Promise<Result> => {
      const reqId = `c${++n}`
      user.send({ ...frame, reqId } as unknown as ClientToUser)
      const answer = await user.expect((f) => (f as { t: string; reqId?: string }).t === "composio" && (f as { reqId?: string }).reqId === reqId, 60_000)
      return (answer as unknown as { result: Result }).result
    }

    // Start clean, then a bad key.
    await ask({ t: "disconnectComposio" })
    const bad = await ask({ t: "connectComposio", apiKey: "ck_not_a_real_key_0000" })
    if (bad.ok) throw new VerifyError("a bad composio key was accepted")
    console.error(`bad key refused: ${bad.error}`)
    const after = await ask({ t: "composioStatus" })
    if (!after.ok) throw new VerifyError(`status after a bad key failed: ${after.error}`)
    expectEqual(after.status.connected, false, "connected after a bad key")
    expectEqual(after.status.rows, 0, "rows after a bad key")

    // The real key.
    const good = await ask({ t: "connectComposio", apiKey: key })
    if (!good.ok) throw new VerifyError(`connect failed: ${good.error}`)
    expectEqual(good.status.connected, true, "connected")
    const badDeveloper = await ask({ t: "setComposioDeveloperKey", key: "ak_not_a_real_key_0000" })
    if (badDeveloper.ok) throw new VerifyError("a bad developer key was accepted")
    console.error(`bad developer key refused: ${badDeveloper.error}`)
    const rows = good.status.rows
    const afterBad = await ask({ t: "composioStatus" })
    if (!afterBad.ok) throw new VerifyError(`status after a bad developer key failed: ${afterBad.error}`)
    expectEqual([afterBad.status.developer, afterBad.status.rows], [false, rows], "developer key and rows after a bad developer key")
    const listed = await ask({ t: "composioStatus", tools: true })
    if (!listed.ok || !listed.tools?.length) throw new VerifyError("composio listed no tools")
    console.error(`tools: ${listed.tools.join(", ")}`)

    const open = async (title: string) => {
      const opened = await newRoom(s, title)
      opened.room.raw.send({ t: "model", ref: MODEL })
      await Bun.sleep(500)
      return opened
    }
    /** Sends `question` and waits for the agent's bubbles and then idle. */
    const turn = async (room: RoomHandle, question: string) => {
      const t0 = performance.now()
      const clientId = room.send(question)
      await room.expect({ t: "ack", clientId })
      let first = 0
      let text = ""
      for (;;) {
        const f = await room.expect((x) => (x.t === "status" && (x as Status).state === "idle" && first > 0) || (x.t === "events" && (x as Events).events.some((e) => e.t === "message" && e.from.kind === "agent")), TURN_MS)
        if (f.t === "status") break
        first ||= performance.now() - t0
        for (const e of (f as Events).events) if (e.t === "message" && e.from.kind === "agent") text += `${e.text} / `
      }
      return { first, text, total: performance.now() - t0 }
    }
    const called = (counters: Record<string, number>) => Object.keys(counters).filter((k) => /^composio\.[^.]+\.ms$/.test(k)).map((k) => k.split(".")[1]!)
    const toolName = (slug: string) => `composio_${slug.replace(/^COMPOSIO_/, "").toLowerCase()}`

    // An agent that opens now, before anything is learned. Part four runs a routine in its room.
    const early = await open("composio routine")
    await turn(early.room, "hi")
    const status = () => dev(v.url, s, "status", { roomId: early.roomId, slug: "yuki" }) as Promise<{ open: boolean }>
    // workerd evicts an object idle for about 10 s, and a cold agent sets up afresh, which would hide a stale open one.
    const keepOpen = setInterval(() => void status().catch(() => undefined), 3_000).unref()

    const chat = async (title: string, question: string) => {
      const { roomId, room } = await open(title)
      await resetStats(v, s)
      const { first, text, total } = await turn(room, question)
      await Bun.sleep(300)

      const counters = await readStats(v, s)
      const tools = called(counters)
      if (!tools.length) throw new VerifyError(`${title}: no composio_* tool was called. the agent said: ${text}`)
      if (!first) throw new VerifyError(`${title}: no reply bubble arrived`)

      console.log(`  ${title}`)
      console.log(`    tools called: ${tools.join(" ")}`)
      console.log(`    models: ${Object.keys(counters).filter((k) => k.startsWith("model.id.")).map((k) => k.slice(9)).join(" ")}, model turns: ${counters["model.turns"] ?? 0}`)
      console.log(`    reply: ${text.slice(0, 200)}`)
      console.log(`    time to first bubble: ${(first / 1000).toFixed(1)} s, total: ${(total / 1000).toFixed(1)} s`)
      user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
      return tools
    }

    await chat("composio", ASK)
    const meta = listed.tools
    const learned = await ask({ t: "composioStatus", tools: true })
    if (!learned.ok) throw new VerifyError(`status after the first chat failed: ${learned.error}`)
    const direct = (learned.tools ?? []).filter((t) => !meta.includes(t))
    console.error(`learned: ${direct.join(", ") || "nothing"}`)
    if (!direct.length) throw new VerifyError("the first chat taught no direct tool")
    if (developerKey) {
      const added = await ask({ t: "setComposioDeveloperKey", key: developerKey })
      if (!added.ok) throw new VerifyError(`adding the developer key failed: ${added.error}`)
      expectEqual(added.status.developer, true, "developer key after adding it")
    }
    const again = await chat("composio again", ASK_AGAIN)
    if (again.includes("composio_search_tools")) throw new VerifyError("the second chat searched again instead of using a learned tool")
    if (!again.some((t) => direct.some((slug) => t === toolName(slug)))) throw new VerifyError(`the second chat called no learned tool: ${again.join(" ")}`)

    // The catalog lookup runs behind adding the developer key, so it has had a whole chat to land.
    const classes = await ask({ t: "composioStatus", tools: true })
    const reads = classes.ok ? direct.filter((slug) => classes.readOnly?.includes(slug)) : []
    console.error(`learned reads: ${reads.join(", ") || "none"}`)
    if (!developerKey) {
      if (reads.length) throw new VerifyError(`learned tools are reads with no developer key: ${reads.join(", ")}`)
      console.log("  routine run: skipped, COMPOSIO_DEVELOPER_KEY is not set, so learned tools stay external")
      clearInterval(keepOpen)
      user.send({ t: "chat", op: { op: "delete", roomId: early.roomId as never } })
      return await disconnect()
    }
    if (!reads.length) throw new VerifyError("no learned tool is a read after adding the developer key")

    // Part four: a routine run, not started by the human, by the agent still open from before the learning.
    clearInterval(keepOpen)
    if (!(await status()).open) throw new VerifyError("the early agent is no longer open, so this run would not test its reload")
    const { routine } = await ok<{ routine: { id: string } }>(v.url, s, "routines", { roomId: early.roomId, name: "deno check", instructions: ROUTINE, trigger: { on: "time", at: inSeconds(3600), rrule: "FREQ=DAILY" } })
    await resetStats(v, s)
    const t0 = performance.now()
    await ok(v.url, s, `routines/${routine.id}/run`, {})
    const cards = () => early.room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? (e.frame as Events).events.filter((ev) => ev.t === "approval") : []))
    for (;;) {
      if (cards().length) throw new VerifyError("the routine run posted an approval card for a learned read tool")
      const runs = await runsOf(v.url, s, routine.id)
      if (runs.some((r) => r.status !== "running")) {
        console.log(`  routine run: ${runs[0]!.status} in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
        break
      }
      if (performance.now() - t0 > TURN_MS) throw new VerifyError("the routine run did not finish")
      await Bun.sleep(500)
    }
    const ran = called(await readStats(v, s))
    console.log(`    tools called: ${ran.join(" ")}`)
    if (!ran.some((t) => reads.some((slug) => t === toolName(slug)))) throw new VerifyError(`the routine run called no learned read tool: ${ran.join(" ") || "none"}`)
    if (cards().length) throw new VerifyError("the routine run posted an approval card")
    user.send({ t: "chat", op: { op: "delete", roomId: early.roomId as never } })
    await disconnect()

    async function disconnect() {
      const gone = await ask({ t: "disconnectComposio" })
      if (!gone.ok) throw new VerifyError(`disconnect failed: ${gone.error}`)
      expectEqual([gone.status.connected, gone.status.developer, gone.status.rows], [false, false, 0], "connected, developer key, and rows after disconnect")
    }
  },
}

export default suite
