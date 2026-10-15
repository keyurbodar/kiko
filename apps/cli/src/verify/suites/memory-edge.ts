import { idles, messages, newRoom, poll } from "../kit"
import type { LifeLine, MemoryOp, MemoryResult, Message, } from "@kiko/protocol"
import type { RoomHandle, } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { dev } from "./team-loops"
import { must } from "../must"


const TYPESAFE = "typesafe"
const FAST = { idleMs: 3_000, jevDelayMs: 1_000, capture: "auto" }
const T0 = Date.now()
const stamp = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`

type Usage = Record<string, number>


const humanMessage = (room: RoomHandle, word: RegExp): Message => {
  const m = messages(room).find((x) => x.from.kind === "human" && word.test(x.text))
  if (!m) throw new VerifyError(`no human message matching ${word} in the chat`)
  return m
}

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
  name: "memory-edge",
  model: true,
  async run(v) {
    const jevKey = process.env.TYPESAFE_API_KEY
    if (!jevKey) throw new VerifyError("TYPESAFE_API_KEY is not set: capture needs a judge key")
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
    const usage = async (): Promise<Usage> => ((await dev(v.url, s.cookie, "usage", { roomId: home.id })) as { memory: Usage }).memory
    const policy = (p: Record<string, unknown>) => dev(v.url, s.cookie, "policy", { policy: p })
    const ok = (name: string, evidence: string) => console.log(`  [${stamp()}] ok ${name}: ${evidence}`)
    const settle = async () => {
      await poll("capture to settle", async () => {
        const before = JSON.stringify(await usage())
        await Bun.sleep(6_000)
        return before === JSON.stringify(await usage())
      }, 60_000)
      await Bun.sleep(2_000)
    }
    const lineTexts = (ls: readonly LifeLine[]) => JSON.stringify(ls.map((l) => l.text))
    const close = (room: RoomHandle & { id: string }) => {
      room.raw.close()
      user.send({ t: "chat", op: { op: "delete", roomId: room.id as never } })
    }

    const home = (await newRoom(s, "memory edge home")).room
    await policy(FAST)
    await s.connectProvider(TYPESAFE, jevKey)
    console.log(`  [${stamp()}] policy set: capture auto, idle 3 s, jev delay 1 s; judge key connected`)
    {
      const priv = (await newRoom(s, "memory edge private")).room
      user.send({ t: "chat", op: { op: "private", roomId: priv.id as never, private: true } })
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
      await s.disconnectProvider(TYPESAFE)
      const attempts: [string, string][] = [
        ["bangalore", "pune"],
        ["chennai", "mumbai"],
      ]
      const outcomes: string[] = []
      for (const [from, to] of attempts) {
        const chat = (await newRoom(s, `memory edge move ${from}`)).room
        await say(chat, `i live in ${from}`)
        const was = new RegExp(from, "i")
        const noted = await poll(`the agent's note about ${from}`, async () => {
          const got = (await live(was)).filter((l) => l.source.startsWith("@"))
          return got.length > 0 && got
        }, 60_000).catch(() => [])
        if (!noted.length) {
          outcomes.push(`${from}: the agent wrote no note`)
          close(chat)
          continue
        }
        await say(chat, `i moved to ${to}`)
        const ids = new Set(noted.map((l) => l.pos))
        const replaced = await poll(`the ${from} line superseded`, async () => (await lines()).some((l) => ids.has(l.pos) && !l.redacted && !isLive(l)), 60_000).catch(() => false)
        const now = (await lines()).filter((l) => was.test(l.text) || new RegExp(to, "i").test(l.text)).map((l) => `${l.source}: ${l.text}${isLive(l) ? "" : " (replaced)"}`)
        outcomes.push(`${from} -> ${to}: ${replaced ? "superseded" : "not superseded"} ${JSON.stringify(now)}`)
        close(chat)
      }
      for (const o of outcomes) console.log(`  [${stamp()}] note replaces: ${o}`)
      if (!outcomes.some((o) => o.includes(": superseded"))) throw new VerifyError("without Jev, the agent's correction did not supersede the old line in either attempt")
      await s.connectProvider(TYPESAFE, jevKey)
      ok("note replaces without Jev", must(outcomes.at(-1), "outcome"))
    }
    {
      await policy(FAST)
      await say(home, "my favourite colour is teal")
      await poll("a live teal line", async () => (await live(/teal/i)).length > 0, 60_000)
      const m = humanMessage(home, /teal/i)
      home.raw.send({ t: "edit", messageId: m.id, text: "my favourite colour is ochre" } as never)
      const t = Date.now()
      await poll("no live teal line and a live ochre line", async () => (await live(/teal/i)).length === 0 && (await live(/ochre/i)).length > 0, 60_000)
      ok("edit", `teal gone and ochre live ${((Date.now() - t) / 1000).toFixed(1)}s after the edit`)
      await policy(FAST)
    }
    {
      const x = (await newRoom(s, "memory edge x")).room
      const y = (await newRoom(s, "memory edge y")).room
      const [bx, by] = [idles(x), idles(y)]
      x.send("my parrot is named quillon")
      y.send("my scooter is called brindle")
      await poll("both chats to answer", async () => idles(x) > bx && idles(y) > by, 90_000)
      await poll("lines for quillon and brindle", async () => (await live(/quillon/i)).length > 0 && (await live(/brindle/i)).length > 0, 60_000)
      x.raw.send({ t: "delete", messageId: humanMessage(x, /quillon/i).id } as never)
      await poll("quillon forgotten", async () => (await live(/quillon/i)).length === 0, 60_000)
      const kept = await live(/brindle/i)
      if (!kept.length) throw new VerifyError("deleting the message in chat X also removed chat Y's fact")
      ok("two chats at once", `both captured; X's fact gone after delete, Y's still live: ${lineTexts(kept)}`)
      close(x)
      close(y)
    }
    {
      const x = (await newRoom(s, "memory edge dentist x")).room
      const y = (await newRoom(s, "memory edge dentist y")).room
      await say(x, "my dentist is dr okafor")
      await poll("a line about okafor", async () => (await live(/okafor/i)).length > 0, 60_000)
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
        await poll("tidewater captured well before the 20 s idle", async () => (await live(/tidewater/i)).length > 0, 15_000)
        const took = (Date.now() - t) / 1000
        const after = (await usage()).capture_jev ?? 0
        if (!(after > before)) throw new VerifyError(`capture_jev did not grow: ${before} -> ${after}`)
        ok("key added while queued", `captured ${took.toFixed(1)}s after the key, capture_jev ${before} -> ${after}`)
        await policy(FAST)
        await Bun.sleep(8_000)
      }
      {
        await say(home, "i work at acme corp")
        await poll("a live acme line", async () => (await live(/acme/i)).length > 0, 60_000)
        await say(home, "i now work at globex")
        await poll("globex live and acme not live", async () => (await live(/globex/i)).length > 0 && (await live(/work(s)? at acme/i)).length === 0, 60_000)
        home.raw.send({ t: "delete", messageId: humanMessage(home, /globex/i).id } as never)
        const t = Date.now()
        await poll("acme live again and globex gone", async () => (await live(/acme/i)).length > 0 && (await live(/globex/i)).length === 0, 60_000)
        ok("delete a correction restores", `acme back ${((Date.now() - t) / 1000).toFixed(1)}s after the delete, globex gone`)
      }
      {
        await say(
          home,
          "my daughter is named pelagia. the pizza at lunch was soggy. i am allergic to quince. what a breezy afternoon. i drive a vintage saab. haha that meeting dragged on forever. ok cool thanks. anyway long day. lol nice one.",
        )
        await poll("lines for pelagia, quince and saab", async () => {
          for (const w of [/pelagia/i, /quince/i, /saab/i]) if (!(await live(w)).length) return false
          return true
        }, 90_000)
        await settle()
        const talk = await live(/soggy|breezy|dragged|haha|\blol\b|long day/i)
        if (talk.length) throw new VerifyError(`small talk reached the life log: ${lineTexts(talk)}`)
        ok("long message", "pelagia, quince and saab captured; no small talk stored")
      }
      {
        const names = ["odalys", "brannock", "teodora", "ximena", "cuthbert", "perpetua", "lucan", "marisol"]
        for (let i = 0; i < names.length; i += 2) await say(home, `my friend ${names[i]} likes jazz. my friend ${names[i + 1]} likes jazz.`)
        let missing = names
        try {
          await poll("lines for all eight friends", async () => {
            const jazz = await live(/jazz/i)
            missing = names.filter((nm) => !jazz.some((l) => l.text.toLowerCase().includes(nm)))
            return missing.length === 0
          }, 120_000)
        } catch (_error) {
          const all = (await lines()).filter((l) => /jazz|friend/i.test(l.text)).map((l) => `${l.pos} ${l.source} ${isLive(l) ? "live" : "gone"} ${l.text}`)
          throw new VerifyError(`friends missing: ${missing.join(", ")}; lines: ${JSON.stringify(all)}; usage ${JSON.stringify(await usage())}`)
        }
        await settle()
        const before = (await usage()).rerank_jev ?? 0
        const chat = (await newRoom(s, "memory edge recall")).room
        const reply = await say(chat, "which of my friends like jazz? list names.")
        const after = (await usage()).rerank_jev ?? 0
        const named = names.filter((nm) => reply.toLowerCase().includes(nm)).length
        console.log(`  [${stamp()}] rerank_jev ${before} -> ${after}; the reply named ${named} of 8 friends`)
        if (after === before) console.log("  note: rerank_jev did not move. the agent may have answered from the card or block without recall, or recall returned six hits or fewer.")
        else ok("rerank", `rerank_jev ${before} -> ${after}`)
        close(chat)
      }
    }
    if (jevKey) {
      await say(home, "mi hermana se llama Ximena y vive en Valencia")
      const sister = /ximena.*(sister|hermana)|(sister|hermana).*ximena/i
      await poll("a live line about the sister ximena", async () => (await live(sister)).length > 0, 90_000)
      await settle()
      const fresh = (await newRoom(s, "memory edge spanish recall")).room
      const reply = await say(fresh, "how is my sister called and where does she live?")
      if (!/ximena/i.test(reply) || !/valencia/i.test(reply)) throw new VerifyError(`a new chat did not say ximena and valencia: ${JSON.stringify(reply)}`)
      ok("non-English fact", `live line ${lineTexts(await live(sister))}; a new chat answered ${JSON.stringify(reply.slice(0, 80))}`)
      close(fresh)
    }
    {
      const bo = { id: `agent-bo-${stampId}`, name: "bo", slug: "bo", prompt: "helps with trips", model: "" }
      user.send({ t: "agent", op: { op: "create", agent: bo as never } })
      const group = (await newRoom(s, "memory edge group", ["kiko", bo.id])).room
      await say(group, "my brother teo lives in oslo, tell @bo too", 120_000)
      await poll("a line about teo", async () => (await live(/\bteo\b|oslo/i)).length > 0, 60_000)
      await settle()
      const hit = (await live(/\bteo\b|oslo/i)).filter((l) => l.source !== "you")
      if (hit.length !== 1) throw new VerifyError(`expected exactly one live line about teo, found ${hit.length}: ${lineTexts(hit)}`)
      const fresh = (await newRoom(s, "memory edge group recall")).room
      const reply = await say(fresh, "where does my brother live?")
      if (!/oslo/i.test(reply)) throw new VerifyError(`a new chat did not say oslo: ${JSON.stringify(reply)}`)
      ok("group chat A2A", `one live line ${lineTexts(hit)}; a new chat answered ${JSON.stringify(reply.slice(0, 80))}`)
      close(fresh)
      close(group)
    }

    await s.disconnectProvider(TYPESAFE)
    close(home)
  },
}

export default suite
