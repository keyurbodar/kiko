import type { LifeLine, MemoryOp, MemoryResult, Message, RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session, UserChannel } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { ulid } from "./mid-run"
import { dev } from "./team-loops"

// Needs OPENCODE_API_KEY; the Jev cases also need TYPESAFE_API_KEY. Never prints a key.

const TYPESAFE = "typesafe"
const FAST = { batch: 2, idleMs: 3_000, jevDelayMs: 1_000, capture: "always" }
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Usage = Record<string, number>

async function openChat(user: UserChannel, s: Session, title: string, agents?: string[]): Promise<RoomHandle> {
  const roomId = ulid()
  user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title, ...(agents ? { agents } : {}) } as never })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = await s.room(roomId)
  await room.expect((f) => f.t === "events")
  Object.assign(room, { id: roomId })
  return room
}
const idOf = (room: RoomHandle) => (room as RoomHandle & { id: string }).id

const frames = (room: RoomHandle) => room.raw.log.flatMap((e) => (e.dir === "in" ? [e.frame as RoomToClient] : []))
const idles = (room: RoomHandle) => frames(room).filter((f) => f.t === "status" && (f as { state: string }).state === "idle").length
const messages = (room: RoomHandle): Message[] => frames(room).flatMap((f) => (f.t === "events" ? f.events.flatMap((e) => (e.t === "message" ? [e as Message] : [])) : []))
const humanMessage = (room: RoomHandle, word: RegExp): Message => {
  const m = messages(room).find((x) => x.from.kind === "human" && word.test(x.text))
  if (!m) throw new VerifyError(`no human message matching ${word} in the chat`)
  return m
}

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
  name: "memory-edge",
  model: true,
  async run(v) {
    const jevKey = process.env.TYPESAFE_API_KEY
    if (!jevKey) console.log("  TYPESAFE_API_KEY is not set: the Jev cases are skipped.")
    const stampId = Date.now().toString(36)
    const s = await v.as(`memedge${stampId}`)
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
    const live = async (word: RegExp) => (await lines()).filter((l) => isLive(l) && word.test(l.text))
    const view = async () => {
      const r = await memory({ op: "view" })
      return "text" in r ? r.text.join("\n") : ""
    }
    const usage = async (): Promise<Usage> => ((await dev(v.url, s.cookie, "usage", { roomId: idOf(home) })) as { memory: Usage }).memory
    const policy = (p: Record<string, unknown>) => dev(v.url, s.cookie, "policy", { policy: p })
    const ok = (name: string, evidence: string) => console.log(`  [${stamp()}] ok ${name}: ${evidence}`)
    /** Waits until the capture counters stop moving for 6 s, then a little longer for an in-flight call. */
    const settle = async () => {
      await poll("capture to settle", 60_000, async () => {
        const before = JSON.stringify(await usage())
        await Bun.sleep(6_000)
        return before === JSON.stringify(await usage())
      })
      await Bun.sleep(2_000)
    }
    const lineTexts = (ls: readonly LifeLine[]) => JSON.stringify(ls.map((l) => l.text))
    const close = (room: RoomHandle) => {
      room.raw.close()
      user.send({ t: "chat", op: { op: "delete", roomId: idOf(room) as never } })
    }

    const home = await openChat(user, s, "memory edge home")
    await policy(FAST)
    console.log(`  [${stamp()}] policy set: capture always, batch 2, idle 3 s, jev delay 1 s`)
    {
      const priv = await openChat(user, s, "memory edge private")
      user.send({ t: "chat", op: { op: "private", roomId: idOf(priv) as never, private: true } })
      await Bun.sleep(1_000)
      await say(priv, "my cat is called zorbalin")
      await settle()
      const hit = (await lines()).filter((l) => /zorbalin/i.test(l.text))
      if (hit.length || /zorbalin/i.test(await view())) throw new VerifyError(`a private chat leaked into the life log: ${lineTexts(hit)}`)
      ok("private", "no life line or view mentions zorbalin after capture settled")
      close(priv)
    }
    {
      await policy({ ...FAST, capture: "off" })
      await say(home, "my locksmith is mr vandermeer")
      await settle()
      const hit = (await lines()).filter((l) => /vandermeer/i.test(l.text) && l.source === "you")
      if (hit.length) throw new VerifyError(`capture off still stored the human's words: ${lineTexts(hit)}`)
      await policy(FAST)
      ok("capture off", "no you line for vandermeer while capture was off; capture set back on")
    }

    {
      await policy({ ...FAST, capture: "auto" })
      const attempts: [string, string][] = [
        ["bangalore", "pune"],
        ["chennai", "mumbai"],
      ]
      const outcomes: string[] = []
      for (const [from, to] of attempts) {
        const chat = await openChat(user, s, `memory edge move ${from}`)
        await say(chat, `i live in ${from}`)
        const was = new RegExp(from, "i")
        const noted = await poll(`the agent's note about ${from}`, 60_000, async () => {
          const got = (await live(was)).filter((l) => l.source.startsWith("@"))
          return got.length > 0 && got
        }).catch(() => [])
        if (!noted.length) {
          outcomes.push(`${from}: the agent wrote no note`)
          close(chat)
          continue
        }
        await say(chat, `i moved to ${to}`)
        const ids = new Set(noted.map((l) => l.pos))
        const replaced = await poll(`the ${from} line superseded`, 60_000, async () => (await lines()).some((l) => ids.has(l.pos) && !l.redacted && !isLive(l))).catch(() => false)
        const now = (await lines()).filter((l) => was.test(l.text) || new RegExp(to, "i").test(l.text)).map((l) => `${l.source}: ${l.text}${isLive(l) ? "" : " (replaced)"}`)
        outcomes.push(`${from} -> ${to}: ${replaced ? "superseded" : "not superseded"} ${JSON.stringify(now)}`)
        close(chat)
      }
      for (const o of outcomes) console.log(`  [${stamp()}] note replaces: ${o}`)
      if (!outcomes.some((o) => o.includes(": superseded"))) throw new VerifyError("without Jev, the agent's correction did not supersede the old line in either attempt")
      await policy(FAST)
      ok("note replaces without Jev", outcomes[outcomes.length - 1]!)
    }
    {
      await say(home, "my favourite colour is teal")
      await poll("a live teal line", 60_000, async () => (await live(/teal/i)).length > 0)
      const m = humanMessage(home, /teal/i)
      home.raw.send({ t: "edit", messageId: m.id, text: "my favourite colour is ochre" } as never)
      const t = Date.now()
      await poll("no live teal line and a live ochre line", 60_000, async () => (await live(/teal/i)).length === 0 && (await live(/ochre/i)).length > 0)
      ok("edit", `teal gone and ochre live ${((Date.now() - t) / 1000).toFixed(1)}s after the edit`)
    }
    {
      const x = await openChat(user, s, "memory edge x")
      const y = await openChat(user, s, "memory edge y")
      const [bx, by] = [idles(x), idles(y)]
      x.send("my parrot is named quillon")
      y.send("my scooter is called brindle")
      await poll("both chats to answer", 90_000, async () => idles(x) > bx && idles(y) > by)
      await poll("lines for quillon and brindle", 60_000, async () => (await live(/quillon/i)).length > 0 && (await live(/brindle/i)).length > 0)
      x.raw.send({ t: "delete", messageId: humanMessage(x, /quillon/i).id } as never)
      await poll("quillon forgotten", 60_000, async () => (await live(/quillon/i)).length === 0)
      const kept = await live(/brindle/i)
      if (!kept.length) throw new VerifyError("deleting the message in chat X also removed chat Y's fact")
      ok("two chats at once", `both captured; X's fact gone after delete, Y's still live: ${lineTexts(kept)}`)
      close(x)
      close(y)
    }
    {
      const x = await openChat(user, s, "memory edge dentist x")
      const y = await openChat(user, s, "memory edge dentist y")
      await say(x, "my dentist is dr okafor")
      await poll("a line about okafor", 60_000, async () => (await live(/okafor/i)).length > 0)
      await say(y, "my dentist is dr okafor")
      await settle()
      const hit = await live(/okafor/i)
      if (hit.length !== 1) throw new VerifyError(`expected one live okafor line, found ${hit.length}: ${lineTexts(hit)}`)
      ok("same fact twice", `one live line: ${lineTexts(hit)}`)
      close(x)
      close(y)
    }

    if (jevKey) {
      {
        await policy({ ...FAST, idleMs: 20_000 })
        const before = (await usage()).capture_jev ?? 0
        home.send("my rowing club is called tidewater")
        await Bun.sleep(300)
        await s.connectProvider(TYPESAFE, jevKey)
        const t = Date.now()
        await poll("tidewater captured well before the 20 s idle", 15_000, async () => (await live(/tidewater/i)).length > 0)
        const took = (Date.now() - t) / 1000
        const after = (await usage()).capture_jev ?? 0
        if (!(after > before)) throw new VerifyError(`capture_jev did not grow: ${before} -> ${after}`)
        ok("key added while queued", `captured ${took.toFixed(1)}s after the key, capture_jev ${before} -> ${after}`)
        await policy(FAST)
        await Bun.sleep(8_000)
      }
      {
        await say(home, "i work at acme corp")
        await poll("a live acme line", 60_000, async () => (await live(/acme/i)).length > 0)
        await say(home, "i now work at globex")
        await poll("globex live and acme not live", 60_000, async () => (await live(/globex/i)).length > 0 && (await live(/work(s)? at acme/i)).length === 0)
        home.raw.send({ t: "delete", messageId: humanMessage(home, /globex/i).id } as never)
        const t = Date.now()
        await poll("acme live again and globex gone", 60_000, async () => (await live(/acme/i)).length > 0 && (await live(/globex/i)).length === 0)
        ok("delete a correction restores", `acme back ${((Date.now() - t) / 1000).toFixed(1)}s after the delete, globex gone`)
      }
      {
        await say(
          home,
          "my daughter is named pelagia. the pizza at lunch was soggy. i am allergic to quince. what a breezy afternoon. i drive a vintage saab. haha that meeting dragged on forever. ok cool thanks. anyway long day. lol nice one.",
        )
        await poll("lines for pelagia, quince and saab", 90_000, async () => {
          for (const w of [/pelagia/i, /quince/i, /saab/i]) if (!(await live(w)).length) return false
          return true
        })
        await settle()
        const talk = await live(/soggy|breezy|dragged|haha|\blol\b|long day/i)
        if (talk.length) throw new VerifyError(`small talk reached the life log: ${lineTexts(talk)}`)
        ok("long message", "pelagia, quince and saab captured; no small talk stored")
      }
      {
        const names = ["odalys", "brannock", "teodora", "ximena", "cuthbert", "perpetua", "lucan", "marisol"]
        for (let i = 0; i < names.length; i += 2) await say(home, `my friend ${names[i]} likes jazz. my friend ${names[i + 1]} likes jazz.`)
        await poll("lines for all eight friends", 120_000, async () => {
          const jazz = await live(/jazz/i)
          return names.every((nm) => jazz.some((l) => l.text.toLowerCase().includes(nm)))
        })
        await settle()
        const before = (await usage()).rerank_jev ?? 0
        const chat = await openChat(user, s, "memory edge recall")
        const reply = await say(chat, "which of my friends like jazz? list names.")
        const after = (await usage()).rerank_jev ?? 0
        const named = names.filter((nm) => reply.toLowerCase().includes(nm)).length
        console.log(`  [${stamp()}] rerank_jev ${before} -> ${after}; the reply named ${named} of 8 friends`)
        if (after === before) console.log("  note: rerank_jev did not move. the agent may have answered from the card or block without recall, or recall returned six hits or fewer.")
        else ok("rerank", `rerank_jev ${before} -> ${after}`)
        close(chat)
      }
    }
    {
      const bo = { id: `agent-bo-${stampId}`, name: "bo", slug: "bo", prompt: "helps with trips", model: "" }
      user.send({ t: "agent", op: { op: "create", agent: bo as never } })
      const group = await openChat(user, s, "memory edge group", ["yuki", bo.id])
      await say(group, "my brother teo lives in oslo, tell @bo too", 120_000)
      await poll("a line about teo", 60_000, async () => (await live(/\bteo\b|oslo/i)).length > 0)
      await settle()
      const hit = await live(/\bteo\b|oslo/i)
      if (hit.length !== 1) throw new VerifyError(`expected exactly one live line about teo, found ${hit.length}: ${lineTexts(hit)}`)
      const fresh = await openChat(user, s, "memory edge group recall")
      const reply = await say(fresh, "where does my brother live?")
      if (!/oslo/i.test(reply)) throw new VerifyError(`a new chat did not say oslo: ${JSON.stringify(reply)}`)
      ok("group chat A2A", `one live line ${lineTexts(hit)}; a new chat answered ${JSON.stringify(reply.slice(0, 80))}`)
      close(fresh)
      close(group)
    }

    if (jevKey) await s.disconnectProvider(TYPESAFE)
    close(home)
  },
}

export default suite
