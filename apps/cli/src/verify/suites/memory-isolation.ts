import type { LifeLine, MemoryOp, MemoryResult, RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session, UserChannel } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { ulid } from "./mid-run"
import { dev } from "./team-loops"

// Needs OPENCODE_API_KEY and TYPESAFE_API_KEY. Never prints a key.

const FAST = { batch: 2, idleMs: 3_000, jevDelayMs: 1_000 }
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Usage = Record<string, number>

/** A made-up word the model cannot guess: a fresh one each run. */
function unique(): string {
  const pick = (s: string) => s[crypto.getRandomValues(new Uint8Array(1))[0]! % s.length]!
  return Array.from({ length: 3 }, () => pick("bdfgklmnprstvz") + pick("aeiou")).join("") + "x"
}

async function openChat(user: UserChannel, s: Session, title: string): Promise<RoomHandle & { id: string }> {
  const roomId = ulid()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title } })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events" || f.t === "reset")
  return Object.assign(room, { id: roomId })
}

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

/** Sends a human message and waits until the chat has gone idle after it. */
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
  name: "memory-isolation",
  model: true,
  async run(v) {
    const jevKey = process.env.TYPESAFE_API_KEY
    if (!jevKey) throw new VerifyError("TYPESAFE_API_KEY is not set in this shell. source the dev vars first")
    const stampId = Date.now().toString(36)

    /** One signed-in user with the test model and the judge connected, and the fast capture policy. */
    const person = async (who: string) => {
      const s = await v.as(`memiso${who}${stampId}`)
      await connectTestModel(s)
      await s.connectProvider("typesafe", jevKey)
      const user = await s.user()
      let n = 0
      const memory = async (op: MemoryOp): Promise<MemoryResult> => {
        const reqId = `m${++n}`
        user.send({ t: "memory", reqId, op })
        return ((await user.expect((f) => f.t === "memory_result" && f.reqId === reqId)) as { result: MemoryResult }).result
      }
      const lines = async (): Promise<readonly LifeLine[]> => {
        const r = await memory({ op: "list", limit: 200 })
        if (!("lines" in r)) throw new VerifyError(`${who}: memory list answered ${JSON.stringify(r)}`)
        return r.lines
      }
      const view = async () => {
        const r = await memory({ op: "view" })
        return "text" in r ? r.text.join("\n") : ""
      }
      const home = await openChat(user, s, `memory isolation ${who}`)
      const usage = async (): Promise<Usage> => ((await dev(v.url, s.cookie, "usage", { roomId: home.id })) as { memory: Usage }).memory
      await dev(v.url, s.cookie, "policy", { policy: FAST })
      return { s, user, home, lines, view, usage }
    }

    const a = await person("a")
    const b = await person("b")
    const [word, name] = [unique(), unique()]
    const mine = new RegExp(`${word}|${name}`, "i")
    const [usageA, usageB] = [await a.usage(), await b.usage()]

    await say(a.home, `my favourite bakery is called ${word}`)
    await say(a.home, `my partner is called ${name}`)
    await poll("A's life list to hold both words", 90_000, async () => {
      const text = (await a.lines()).map((l) => l.text).join("\n")
      return text.includes(word) && text.includes(name)
    })
    console.log(`  [${stamp()}] A's life list holds both words`)

    const afterA = await a.usage()
    const moved = Object.keys(afterA).filter((k) => k.startsWith("capture") && (afterA[k] ?? 0) > (usageA[k] ?? 0))
    if (!moved.length) throw new VerifyError(`A's capture counters did not move: ${JSON.stringify(usageA)} -> ${JSON.stringify(afterA)}`)
    const afterB = await b.usage()
    const stirred = Object.keys({ ...usageB, ...afterB }).filter((k) => k.startsWith("capture") && (afterB[k] ?? 0) !== (usageB[k] ?? 0))
    if (stirred.length) throw new VerifyError(`B's capture counters moved from A's activity: ${stirred.join(", ")}`)
    console.log(`  [${stamp()}] A's counters moved (${moved.join(", ")}); B's capture counters did not`)

    const leak = (await b.lines()).filter((l) => mine.test(l.text))
    if (leak.length || mine.test(await b.view())) throw new VerifyError("A's words appear in B's memory list or view")
    const chat = await openChat(b.user, b.s, "memory isolation b ask")
    const reply = await say(chat, "what is my partner called and what is my favourite bakery called?")
    if (mine.test(reply)) throw new VerifyError(`B's agent answered with A's words: ${JSON.stringify(reply)}`)
    console.log(`  [${stamp()}] B's list, view and answer hold neither word: ${JSON.stringify(reply.slice(0, 100))}`)

    await a.s.disconnectProvider("typesafe")
    await b.s.disconnectProvider("typesafe")
  },
}

export default suite
