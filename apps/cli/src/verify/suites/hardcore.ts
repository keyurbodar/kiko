import { poll } from "../kit"
import { newRoomId } from "@yuki/protocol"
import type { Message, RoomToClient } from "@yuki/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"



type Seen = { messages: Message[]; members: string[]; runs: Map<string, number> }

function seen(room: RoomHandle): Seen {
  const messages = new Map<string, Message>()
  const members = new Set<string>()
  const runs = new Map<string, number>()
  const busy = new Set<string>()
  for (const entry of room.raw.log) {
    if (entry.dir !== "in") continue
    const f = entry.frame as RoomToClient
    if (f.t === "reset") {
      for (const m of f.snapshot.messages) messages.set(m.id, m)
      for (const m of f.snapshot.members) members.add(m.slug)
    }
    if (f.t === "status") {
      if (f.state !== "idle" && !busy.has(f.slug)) {
        busy.add(f.slug)
        runs.set(f.slug, (runs.get(f.slug) ?? 0) + 1)
      }
      if (f.state === "idle") busy.delete(f.slug)
    }
    if (f.t !== "events") continue
    for (const e of f.events) {
      if (e.t === "message") messages.set(e.id, e)
      if (e.t === "delete") for (const id of e.messageIds) messages.delete(id)
      if (e.t === "member") members.add(e.member.slug)
    }
  }
  return { messages: [...messages.values()].sort((a, b) => a.seq - b.seq), members: [...members], runs }
}

const who = (m: Message) => (m.from.kind === "agent" ? `@${m.from.slug}` : m.from.kind)
const after = (room: RoomHandle, seq: number) => seen(room).messages.filter((m) => m.seq > seq)
const agentSays = (room: RoomHandle, seq: number, slug?: string) =>
  after(room, seq).filter((m) => m.from.kind === "agent" && (!slug || m.from.slug === slug))
const lastSeq = (room: RoomHandle) => seen(room).messages.at(-1)?.seq ?? 0
const quiet = async (room: RoomHandle, ms: number, cap: number) => {
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

function print(room: RoomHandle, from: number) {
  for (const m of after(room, from)) console.log(`      ${who(m).padEnd(8)} ${m.text.replace(/\s+/g, " ").slice(0, 140)}`)
}

const suite: Suite = {
  name: "hardcore",
  model: true,
  async run(v) {
    const s = await v.as(`hardcore-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const ada = { id: `agent-ada-${Date.now()}`, name: "ada", slug: "ada" as never, prompt: "you love food and wine and you are a bit witty.", model: "" }
    user.send({ t: "agent", op: { op: "create", agent: ada } })
    const roomId = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "dinner crew", agents: ["yuki", ada.id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await poll("the members", () => seen(room).members.length >= 2, 10_000).catch(() => {})
    const step = (t: string) => console.log(`  ok ${t}`)
    const fail: string[] = []

    let from = lastSeq(room)
    let t0 = Date.now()
    for (const text of ["hey", "so", "i'm planning a dinner party", "for 6 people", "on saturday, any ideas?"]) {
      room.send(text)
      await Bun.sleep(350)
    }
    await poll("the lead's answer", () => agentSays(room, from, "yuki").length > 0, 60_000)
    const firstLead = Date.now() - t0
    await quiet(room, 6_000, 90_000)
    const leadRuns = seen(room).runs.get("yuki") ?? 0
    print(room, from)
    if (leadRuns !== 1) fail.push(`rapid fire: the lead ran ${leadRuns} times for one burst`)
    // The lead may hand part of the burst to ada; she must not speak before the lead tags her.
    const leadTagsAda = agentSays(room, from, "yuki").find((m) => /@ada\b/i.test(m.text))?.seq ?? Number.POSITIVE_INFINITY
    if (agentSays(room, from, "ada").some((m) => m.seq < leadTagsAda)) fail.push("rapid fire: ada spoke on a message that tagged nobody")
    step(`rapid fire: 5 messages, the lead answered once (first bubble ${firstLead} ms), ada was not woken`)

    from = lastSeq(room)
    room.send("@ada what wine goes with a mushroom risotto?")
    await poll("ada's answer", () => agentSays(room, from, "ada").length > 0, 60_000)
    await quiet(room, 5_000, 60_000)
    print(room, from)
    const adaToYuki = agentSays(room, from, "ada").some((m) => /@yuki\b/.test(m.text))
    if (agentSays(room, from, "yuki").length && !adaToYuki) fail.push("tagged: yuki spoke on a message tagged only for ada")
    step(`tagged: ada answered${adaToYuki ? " (and messaged yuki, who answered her)" : ", yuki stayed quiet"}`)

    from = lastSeq(room)
    room.send("@yuki please add a new agent to this chat, a designer called nova, and ask nova to suggest 3 colors for the invite card")
    await poll("nova to join", () => seen(room).members.includes("nova"), 90_000)
    await poll("nova to speak", () => agentSays(room, from, "nova").length > 0, 90_000)
    await quiet(room, 6_000, 90_000)
    print(room, from)
    step("spawn: the lead added @nova and nova answered")

    from = lastSeq(room)
    room.send("@yuki ask ada for one dessert idea, then tell me what she said")
    await poll("an agent-to-agent message", () => after(room, from).some((m) => m.from.kind === "agent" && /@ada\b/.test(m.text) && m.from.slug === "yuki"), 90_000)
    await poll("ada's answer to yuki", () => agentSays(room, from, "ada").length > 0, 90_000)
    await quiet(room, 8_000, 120_000)
    print(room, from)
    const yukiRuns = seen(room).runs.get("yuki") ?? 0
    const answerAt = agentSays(room, from, "ada")[0]?.seq
    if (!agentSays(room, from, "yuki").some((m) => m.seq > answerAt)) fail.push("a2a: yuki never told the human what ada said")
    step(`a2a: yuki asked ada, ada answered, and yuki passed it on (yuki runs so far: ${yukiRuns})`)

    from = lastSeq(room)
    t0 = Date.now()
    room.send("@yuki remind me in 20 seconds to buy candles")
    await poll("the reminder line", () => after(room, from).some((m) => m.from.kind === "system" && /candle/i.test(m.text)), 120_000)
    const fired = (Date.now() - t0) / 1000
    print(room, from)
    if (fired < 15) fail.push(`reminder: fired after ${fired.toFixed(0)} s, too early`)
    step(`reminder: posted after ${fired.toFixed(0)} s`)
    await quiet(room, 4_000, 30_000)

    from = lastSeq(room)
    room.send("@yuki what should the main course be")
    await poll("yuki typing", () => room.raw.log.slice(-40).some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as Extract<RoomToClient, { t: "status" }>).state !== "idle"), 30_000)
    room.send("@yuki oh and one guest is vegetarian")
    await poll("yuki's answer", () => agentSays(room, from, "yuki").length > 0, 90_000)
    await quiet(room, 6_000, 90_000)
    print(room, from)
    const answer = agentSays(room, from, "yuki").map((m) => m.text).join(" ")
    if (!/vegetar|veggie|meat-free|plant/i.test(answer)) fail.push("interrupt: the reply ignored the vegetarian guest")
    step("interrupt: the reply took the second message into account")

    room.raw.close()
    if (fail.length) throw new VerifyError(fail.join("\n  "))
  },
}

export default suite
