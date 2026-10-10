import type { LifeLine, MemoryOp, MemoryResult, RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session, UserChannel } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { ulid } from "./mid-run"
import { dev } from "./team-loops"

// P15. Facts come from the human's own messages. With a TypeSafe (Jev) key the judgments use it;
// without one a base path does the same job. The key is added, refused and removed while chat A's
// agent is alive, and capture must follow with no restart. Needs OPENCODE_API_KEY and, for the Jev
// half, TYPESAFE_API_KEY in the CLI's environment. Never prints a key.

const TYPESAFE = "typesafe"
const WRONG_KEY = `apikey_${"0".repeat(64)}`
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Usage = Record<string, number>

async function openChat(user: UserChannel, s: Session, title: string): Promise<RoomHandle> {
  const roomId = ulid()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events")
  Object.assign(room, { id: roomId })
  return room
}
const idOf = (room: RoomHandle) => (room as RoomHandle & { id: string }).id

const frames = (room: RoomHandle) => room.raw.log.flatMap((e) => (e.dir === "in" ? [e.frame as RoomToClient] : []))
const idles = (room: RoomHandle) => frames(room).filter((f) => f.t === "status" && (f as { state: string }).state === "idle").length
const messages = (room: RoomHandle) => frames(room).flatMap((f) => (f.t === "events" ? f.events.flatMap((e) => (e.t === "message" ? [e] : [])) : []))

async function poll<T>(what: string, ms: number, test: () => Promise<T | false | null | undefined>): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const got = await test()
    if (got) return got
    if (Date.now() > end) throw new VerifyError(`timed out after ${ms / 1000}s waiting for ${what}`)
    await Bun.sleep(1_000)
  }
}

/** Sends a human message and waits until the agent has answered it. */
async function say(room: RoomHandle, text: string, ms = 90_000): Promise<string> {
  const before = idles(room)
  const seen = messages(room).length
  room.send(text)
  await poll(`an answer to ${JSON.stringify(text)}`, ms, async () => idles(room) > before)
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
    if (!jevKey) console.log("  TYPESAFE_API_KEY is not set: the Jev half (steps 3, 5, 6) is skipped. Only the base path runs.")
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
    /** A superseded line may come back from `list` flagged or with the tree's "(replaced" mark. */
    const isLive = (l: LifeLine) => {
      const extra = l as LifeLine & { supersededBy?: number | null; superseded?: unknown }
      return !l.redacted && extra.supersededBy == null && !extra.superseded && !/\(replaced/i.test(l.text)
    }
    const live = async (word: RegExp, source?: string) => (await lines()).filter((l) => isLive(l) && word.test(l.text) && (!source || l.source === source))
    const usage = async (): Promise<Usage> => ((await dev(v.url, s.cookie, "usage", { roomId: idOf(chatA) })) as { memory: Usage }).memory
    const show = async (step: string) => console.log(`  [${stamp()}] ${step}: ${JSON.stringify(await usage())}`)
    const credentials = async (): Promise<{ id: string; refused?: boolean }[]> => {
      const res = await fetch(new URL("api/credentials", v.url.endsWith("/") ? v.url : `${v.url}/`), { headers: { cookie: s.cookie }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new VerifyError(`GET api/credentials answered ${res.status}`)
      return ((await res.json()) as { providers: { id: string; refused?: boolean }[] }).providers
    }

    // 1. A policy that captures fast.
    const chatA = await openChat(user, s, "memory jev a")
    await dev(v.url, s.cookie, "policy", { policy: { batch: 2, idleMs: 3_000, jevDelayMs: 1_000 } })
    console.log(`  [${stamp()}] 1 policy set: batch 2, idle 3 s, jev delay 1 s`)

    // 2. Base path, no Jev key.
    await say(chatA, "my sister lives in lisbon and works as a nurse")
    await say(chatA, "i live in bangalore")
    await poll("life lines from you about lisbon and bangalore", 60_000, async () => {
      const mine = (await lines()).filter((l) => l.source === "you" && !l.redacted)
      return mine.some((l) => /lisbon/i.test(l.text)) && mine.some((l) => /bangalore/i.test(l.text))
    })
    let u = await usage()
    await show("2 base capture")
    if (!((u.capture_model ?? 0) >= 1)) throw new VerifyError(`base path did not capture: capture_model is ${u.capture_model ?? 0}`)
    if ((u.capture_jev ?? 0) !== 0) throw new VerifyError(`capture_jev is ${u.capture_jev} with no TypeSafe key`)

    if (jevKey) {
      // 3. Mid-session enable. Chat A's agent is idle and is not restarted.
      await s.connectProvider(TYPESAFE, jevKey)
      const firstModel = u.capture_model ?? 0
      await say(chatA, "btw i moved to pune last month")
      await poll("a line from you about pune and bangalore no longer live", 60_000, async () => {
        const [pune, bangalore] = [await live(/pune/i, "you"), await live(/bangalore/i)]
        return pune.length > 0 && bangalore.length === 0
      })
      u = await usage()
      await show("3 jev capture, correction replaced bangalore")
      if (!((u.capture_jev ?? 0) >= 1)) throw new VerifyError(`capture_jev is ${u.capture_jev ?? 0} after the key was added mid-session`)
      if (!((u.facts_replaced ?? 0) >= 1)) throw new VerifyError(`facts_replaced is ${u.facts_replaced ?? 0}`)
      console.log(`  capture_model stayed at ${u.capture_model ?? 0} (was ${firstModel})`)
    }

    // 4. Privacy.
    await say(chatA, "my bank pin is 4921")
    const quiet = await poll("capture to settle", 40_000, async () => {
      const before = await usage()
      await Bun.sleep(6_000)
      const after = await usage()
      return JSON.stringify(before) === JSON.stringify(after) && after
    })
    const leaked = (await lines()).filter((l) => l.text.includes("4921"))
    const view = await memory({ op: "view" })
    const viewLeak = "text" in view && view.text.some((t) => t.includes("4921"))
    await show("4 privacy")
    if (leaked.length || viewLeak) throw new VerifyError(`4921 reached the life log: ${leaked.length} lines, in view: ${viewLeak}`)
    if (jevKey && !((quiet.facts_private ?? 0) >= 1)) throw new VerifyError(`facts_private is ${quiet.facts_private ?? 0}`)

    if (jevKey) {
      // 5. Cross-chat recall of the corrected fact.
      const chatB = await openChat(user, s, "memory jev b")
      const reply = await say(chatB, "where do i live now and what does my sister do? answer in one short line.")
      console.log(`  [${stamp()}] 5 chat B answered ${JSON.stringify(reply)}`)
      if (!/pune/i.test(reply)) throw new VerifyError(`chat B did not say pune: ${JSON.stringify(reply)}`)
      if (!/nurse/i.test(reply)) throw new VerifyError(`chat B did not say nurse: ${JSON.stringify(reply)}`)
      if (/bangalore/i.test(reply)) throw new VerifyError(`chat B named the replaced city: ${JSON.stringify(reply)}`)
      chatB.raw.close()

      // 6. Delete forgets.
      const punes = messages(chatA).filter((m) => m.from.kind === "human" && /pune/i.test(m.text))
      if (!punes.length) throw new VerifyError("the pune message is not in chat A's log")
      for (const m of punes) chatA.raw.send({ t: "delete", messageId: m.id })
      const t = Date.now()
      await poll("no live line about pune after the message was deleted", 60_000, async () => (await live(/pune/i)).length === 0)
      console.log(`  [${stamp()}] 6 pune forgotten ${((Date.now() - t) / 1000).toFixed(1)}s after delete`)
    }

    // 7. A refused key. The base path takes over.
    const beforeRefused = (await usage()).capture_model ?? 0
    await s.connectProvider(TYPESAFE, WRONG_KEY)
    await say(chatA, "my favourite tea is genmaicha")
    await poll("a line about genmaicha", 60_000, async () => (await live(/genmaicha/i, "you")).length > 0)
    u = await usage()
    await show("7 refused key")
    if (!((u.capture_model ?? 0) > beforeRefused)) throw new VerifyError(`capture_model did not grow with a refused key: ${beforeRefused} -> ${u.capture_model ?? 0}`)
    const row = await poll("the typesafe row marked refused", 15_000, async () => (await credentials()).find((p) => p.id === TYPESAFE && p.refused === true))
    console.log(`  [${stamp()}] 7 typesafe row refused: ${row.refused}`)

    // 8. Remove the key. Capture keeps working.
    await s.disconnectProvider(TYPESAFE)
    const beforeRemoved = (await usage()).capture_model ?? 0
    await say(chatA, "i keep my notes in a notebook called ember")
    await poll("a line about ember", 60_000, async () => (await live(/ember/i, "you")).length > 0)
    u = await usage()
    await show("8 key removed")
    if (!((u.capture_model ?? 0) > beforeRemoved)) throw new VerifyError(`capture_model did not grow after the key was removed: ${beforeRemoved} -> ${u.capture_model ?? 0}`)

    chatA.raw.close()
    user.send({ t: "chat", op: { op: "delete", roomId: idOf(chatA) as never } })
  },
}

export default suite
