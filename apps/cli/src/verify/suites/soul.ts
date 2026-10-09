import type { FileRef, Message, RoomToClient } from "@yuki/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { until } from "./mid-run"

// Architecture section 8.4, with the real model. One group (yuki the chief and ada):
//
//   1. voice      a plain question gets a short, lowercase answer with no filler
//   2. soul       a correction of how yuki talks lands in its soul, quietly: /api/souls/yuki changes,
//                 and yuki does not announce that it remembered
//   3. chat file  a decision lands in /chat.md, which the room seeded for the group
//
// Each step prints what happened, so a human can read the voice.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ulid = () => {
  let t = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[t % 32] + head
    t = Math.floor(t / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

function seen(room: RoomHandle): { messages: Message[]; files: Map<string, FileRef> } {
  const messages = new Map<string, Message>()
  const files = new Map<string, FileRef>()
  for (const entry of room.raw.log) {
    const f = entry.frame as RoomToClient
    if (entry.dir !== "in" || f.t !== "events") continue
    for (const e of f.events) {
      if (e.t === "message") messages.set(e.id, e)
      if (e.t === "file") files.set(e.file.name, e.file)
    }
  }
  return { messages: [...messages.values()].sort((a, b) => a.seq - b.seq), files }
}

const yukiSays = (room: RoomHandle, after: number) => seen(room).messages.filter((m) => m.seq > after && m.from.kind === "agent" && m.from.slug === "yuki")
const lastSeq = (room: RoomHandle) => seen(room).messages.at(-1)?.seq ?? 0
const FILLER = /great question|happy to help|let me know if|i'd be happy|certainly!|absolutely!/i
const ANNOUNCED = /\b(i'll remember|i will remember|noted|got it, i'll|i've (saved|updated|noted)|updating my (soul|profile)|soul\.md)\b/i

async function quiet(room: RoomHandle, ms: number, cap: number) {
  const end = Date.now() + cap
  let n = room.raw.log.length
  let since = Date.now()
  while (Date.now() < end) {
    await Bun.sleep(250)
    if (room.raw.log.length !== n) {
      n = room.raw.log.length
      since = Date.now()
    } else if (Date.now() - since >= ms) return
  }
}

const suite: Suite = {
  name: "soul",
  model: true,
  async run(v) {
    const s = await v.as(`soul-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const ada = { id: `agent-ada-${Date.now()}`, name: "ada", slug: "ada" as never, prompt: "you plan food and drink. opinionated about wine.", model: "" }
    user.send({ t: "agent", op: { op: "create", agent: ada } })
    const roomId = ulid()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "lisbon trip", agents: ["yuki", ada.id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const soulNow = async () => ((await (await fetch(new URL(`api/souls/yuki`, v.url.endsWith("/") ? v.url : `${v.url}/`), { headers: { cookie: s.cookie } })).json()) as { body: string }).body
    const soulBefore = await soulNow()
    const fail: string[] = []

    // 1. Voice.
    let from = lastSeq(room)
    let t0 = Date.now()
    room.send("what's a good neighborhood to stay in lisbon?")
    await until("yuki's answer", () => yukiSays(room, from).length > 0, 90_000)
    await quiet(room, 5_000, 60_000)
    const voice = yukiSays(room, from).map((m) => m.text)
    console.log(`  voice (${Date.now() - t0} ms): ${JSON.stringify(voice)}`)
    const words = voice.join(" ").split(/\s+/).length
    if (FILLER.test(voice.join(" "))) fail.push("voice: filler phrase")
    if (voice.join(" ") !== voice.join(" ").toLowerCase()) console.log("  note: some capitals in the voice")
    if (words > 90) fail.push(`voice: ${words} words for a quick question`)

    // 2. Soul: a correction of how yuki talks.
    from = lastSeq(room)
    t0 = Date.now()
    room.send("@yuki from now on, never use emojis with me, and always give me exactly one recommendation, not a list.")
    await until("yuki's reply", () => yukiSays(room, from).length > 0, 90_000)
    await quiet(room, 6_000, 60_000)
    const reply = yukiSays(room, from).map((m) => m.text)
    const soulAfter = await soulNow()
    console.log(`  correction reply (${Date.now() - t0} ms): ${JSON.stringify(reply)}`)
    console.log(`  soul grew by ${soulAfter.length - soulBefore.length} chars: ${JSON.stringify(soulAfter.slice(soulBefore.length > 40 ? soulAfter.indexOf("learned") : 0).slice(0, 300))}`)
    if (soulAfter === soulBefore) fail.push("soul: the correction never reached yuki's soul")
    if (!/emoji/i.test(soulAfter)) fail.push("soul: nothing about emojis in the soul")
    if (ANNOUNCED.test(reply.join(" "))) fail.push(`soul: yuki announced it: ${JSON.stringify(reply.join(" "))}`)

    // 3. The chat file.
    from = lastSeq(room)
    t0 = Date.now()
    if (!seen(room).files.has("chat.md")) fail.push("chat file: the room did not seed /chat.md for the group")
    const budget = `${600 + Math.floor(Math.random() * 300)} euros`
    room.send(`ok decided: the budget is ${budget} for the whole trip, and we fly on the 14th.`)
    await until("yuki's reply", () => yukiSays(room, from).length > 0, 90_000)
    await quiet(room, 8_000, 90_000)
    console.log(`  decision reply (${Date.now() - t0} ms): ${JSON.stringify(yukiSays(room, from).map((m) => m.text))}`)
    const chat = seen(room).files.get("chat.md")
    const base = new URL(`api/files/${roomId}/`, v.url.endsWith("/") ? v.url : `${v.url}/`)
    const text = chat ? await (await fetch(new URL(chat.id, base), { headers: { cookie: s.cookie } })).text() : ""
    console.log(`  /chat.md: ${JSON.stringify(text)}`)
    if (!text.includes(budget.split(" ")[0]!)) fail.push("chat file: the budget is not in /chat.md")

    room.raw.close()
    if (fail.length) throw new VerifyError(fail.join("\n  "))
  },
}

export default suite
