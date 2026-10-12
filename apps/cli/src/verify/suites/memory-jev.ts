import { idles, messages, newRoom, poll } from "../kit"
import type { LifeLine, MemoryOp, MemoryResult, } from "@yuki/protocol"
import type { RoomHandle, } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev } from "./team-loops"


const TYPESAFE = "typesafe"
const WRONG_KEY = `apikey_${"0".repeat(64)}`
const FAST = { idleMs: 3_000, jevDelayMs: 1_000 }
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Usage = Record<string, number>


async function say(room: RoomHandle, text: string, ms = 90_000): Promise<string> {
  const before = idles(room)
  const seen = messages(room).length
  room.send(text)
  await poll(`an answer to ${JSON.stringify(text)}`, async () => idles(room) > before, ms)
  await Bun.sleep(500)
  return messages(room)
    .slice(seen)
    .filter((m) => m.from.kind === "agent")
    .map((m) => m.text)
    .join("\n")
}

const suite: Suite = {
  name: "memory-jev",
  model: true,
  async run(v) {
    const jevKey = process.env.TYPESAFE_API_KEY
    if (!jevKey) console.log("  TYPESAFE_API_KEY is not set: the Jev steps are skipped.")
    const s = await v.as(`memjev${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const memory = async (op: MemoryOp): Promise<MemoryResult> => {
      const reqId = `m${++n}`
      user.send({ t: "memory", reqId, op })
      return ((await user.expect((f) => f.t === "memory_result" && f.reqId === reqId)) as { result: MemoryResult }).result
    }
    const lines = async (): Promise<readonly LifeLine[]> => {
      const r = await memory({ op: "list", limit: 200 })
      if (!("lines" in r)) throw new VerifyError(`memory list answered ${JSON.stringify(r)}`)
      return r.lines
    }
    const isLive = (l: LifeLine) => {
      const extra = l as LifeLine & { supersededBy?: number | null; superseded?: unknown }
      return !l.redacted && extra.supersededBy == null && !extra.superseded && !/\(replaced/i.test(l.text)
    }
    const live = async (word: RegExp, source?: (s: string) => boolean) => (await lines()).filter((l) => isLive(l) && word.test(l.text) && (!source || source(l.source)))
    const usage = async (): Promise<Usage> => ((await dev(v.url, s.cookie, "usage", { roomId: chatA.id })) as { memory: Usage }).memory
    const show = async (step: string) => console.log(`  [${stamp()}] ${step}: ${JSON.stringify(await usage())}`)
    const policy = (p: Record<string, unknown>) => dev(v.url, s.cookie, "policy", { policy: { ...FAST, ...p } })
    const settle = () =>
      poll("capture to settle", async () => {
        const before = await usage()
        await Bun.sleep(6_000)
        const after = await usage()
        return JSON.stringify(before) === JSON.stringify(after) && after
      }, 40_000)
    const credentials = async (): Promise<{ provider: string; refused?: boolean }[]> => {
      const res = await fetch(new URL("api/credentials", v.url), { headers: { cookie: s.cookie }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new VerifyError(`GET api/credentials answered ${res.status}`)
      return ((await res.json()) as { providers: { provider: string; refused?: boolean }[] }).providers
    }
    const fromAgent = (source: string) => source.startsWith("@")
    const fromYou = (source: string) => source === "you"

    const chatA = (await newRoom(s, "memory jev a")).room
    await policy({})
    console.log(`  [${stamp()}] policy: default capture (auto), idle 3 s, jev delay 1 s`)

    await say(chatA, "my sister lives in lisbon and works as a nurse")
    const noted = await poll("the agent's own note about lisbon or the nurse", async () => {
      const got = await live(/lisbon|nurse/i, fromAgent)
      return got.length > 0 && got
    }, 60_000)
    let u = await settle()
    await show("no judge, default policy")
    if ((u.capture_jev ?? 0) !== 0) throw new VerifyError(`capture_jev is ${u.capture_jev} with no judge`)
    const captured = await live(/lisbon|nurse/i, fromYou)
    if (captured.length) throw new VerifyError(`capture auto stored the human's words with no judge: ${JSON.stringify(captured.map((l) => l.text))}`)
    console.log(`  agent noted: ${JSON.stringify(noted.map((l) => `${l.source}: ${l.text}`))}`)

    await say(chatA, "i live in bangalore")
    await poll("the agent noted bangalore", async () => (await live(/bangalore/i, fromAgent)).length > 0, 60_000)

    if (jevKey) {
      await s.connectProvider(TYPESAFE, jevKey)
      await policy({})
      await say(chatA, "btw i moved to pune last month")
      await poll("a line about pune, and no live line saying they live in bangalore", async () => {
        const [pune, bangalore] = [await live(/pune/i), await live(/\bliv(e|es|ing) in bangalore/i)]
        return pune.length > 0 && bangalore.length === 0
      }, 60_000)
      u = await usage()
      await show("jev added mid-session, auto: the correction replaced bangalore")
      if (!((u.capture_jev ?? 0) >= 1)) throw new VerifyError(`capture_jev is ${u.capture_jev ?? 0} after the key was added mid-session`)
      if (!((u.facts_replaced ?? 0) >= 1) && !(await lines()).some((l) => /bangalore/i.test(l.text) && l.supersededBy != null)) throw new VerifyError("no bangalore line was replaced, by Jev or by a note")
    }

    const errorsBefore = (await usage()).jev_errors ?? 0
    await say(chatA, "my bank pin is 4921")
    const quiet = await settle()
    const jevFailed = (quiet.jev_errors ?? 0) > errorsBefore
    const leaked = (await lines()).filter((l) => l.text.includes("4921"))
    const view = await memory({ op: "view" })
    const viewLeak = "text" in view && view.text.some((t) => t.includes("4921"))
    await show("privacy")
    if (leaked.length || viewLeak) throw new VerifyError(`4921 reached the life log: ${leaked.length} lines, in view: ${viewLeak}`)
    if (jevKey && jevFailed) console.log(`  note: jev_errors grew during this step, so facts_private is not required (${quiet.facts_private ?? 0})`)
    else if (jevKey && !((quiet.facts_private ?? 0) >= 1)) throw new VerifyError(`facts_private is ${quiet.facts_private ?? 0}`)

    if (jevKey) {
      const chatB = (await newRoom(s, "memory jev b")).room
      const reply = await say(chatB, "where do i live now and what does my sister do? answer in one short line.")
      console.log(`  [${stamp()}] chat B answered ${JSON.stringify(reply)}`)
      if (!/pune/i.test(reply)) throw new VerifyError(`chat B did not say pune: ${JSON.stringify(reply)}`)
      if (!/nurse/i.test(reply)) throw new VerifyError(`chat B did not say nurse: ${JSON.stringify(reply)}`)
      if (/bangalore/i.test(reply)) throw new VerifyError(`chat B named the replaced city: ${JSON.stringify(reply)}`)
      chatB.raw.close()

      const punes = messages(chatA).filter((m) => m.from.kind === "human" && /pune/i.test(m.text))
      if (!punes.length) throw new VerifyError("the pune message is not in chat A's log")
      for (const m of punes) chatA.raw.send({ t: "delete", messageId: m.id })
      const t = Date.now()
      await poll("no live line about pune after the message was deleted", async () => (await live(/pune/i)).length === 0, 60_000)
      console.log(`  [${stamp()}] pune forgotten ${((Date.now() - t) / 1000).toFixed(1)}s after delete`)
    }

    await policy({})
    await s.connectProvider(TYPESAFE, WRONG_KEY)
    await say(chatA, "my favourite tea is genmaicha")
    const row = await poll("the typesafe row marked refused", async () => (await credentials()).find((p) => p.provider === TYPESAFE && p.refused === true), 30_000)
    console.log(`  [${stamp()}] typesafe row refused: ${row.refused}`)

    await s.disconnectProvider(TYPESAFE)
    await say(chatA, "i keep my notes in a notebook called ember")
    await poll("the agent noted ember", async () => (await live(/ember/i, fromAgent)).length > 0, 60_000)
    await show("key removed, agents note")

    chatA.raw.close()
    user.send({ t: "chat", op: { op: "delete", roomId: chatA.id as never } })
  },
}

export default suite
