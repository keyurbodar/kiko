import type { Message, RoomToClient } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { until } from "./mid-run"

// Architecture section 7.5. Two real agents hand a file to each other. The lead writes a draft,
// hands it to ada with send_message's files, and ada reads it and answers in the room. Nothing is
// copied: the message carries the file, and ada can only name the dishes by reading it.

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

function messages(room: RoomHandle): Message[] {
  const out = new Map<string, Message>()
  for (const entry of room.raw.log) {
    const f = entry.frame as RoomToClient
    if (entry.dir === "in" && f.t === "events") for (const e of f.events) if (e.t === "message") out.set(e.id, e)
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq)
}

const suite: Suite = {
  name: "file-handoff",
  model: true,
  async run(v) {
    const s = await v.as(`handoff-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const ada = { id: `agent-ada-${Date.now()}`, name: "ada", slug: "ada" as never, prompt: "you are a chef. you judge menus.", model: "" }
    user.send({ t: "agent", op: { op: "create", agent: ada } })
    const roomId = ulid()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "menu", agents: ["kiko", ada.id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const dish = `zarzuela-${Math.random().toString(36).slice(2, 6)}`
    const t0 = Date.now()
    room.send(
      `@kiko write /drafts/menu.md listing three dishes, one of them exactly "${dish}". then hand that file to ada with send_message and its files, asking her to name all three dishes and pick the best. don't paste the menu in the message.`,
    )
    const find = () => messages(room).find((m) => m.from.kind === "agent" && m.from.slug === "kiko" && m.files?.some((f) => f.name === "drafts/menu.md"))
    await until("kiko's message to ada with the file", () => find() !== undefined, 120_000)
    const handed = find()!
    if (handed.text.includes(dish)) console.log("  note: kiko also pasted the dish into the message")
    console.log(`  handed over after ${Date.now() - t0} ms: ${JSON.stringify(handed.text.slice(0, 120))}`)
    const adaSays = () => messages(room).filter((m) => m.seq > handed.seq && m.from.kind === "agent" && m.from.slug === "ada").map((m) => m.text)
    await until("ada's answer naming the dish that is only in the file", () => adaSays().join(" ").toLowerCase().includes(dish), 120_000).catch(() => {})
    const adaSaid = adaSays()
    console.log(`  ada after ${Date.now() - t0} ms: ${JSON.stringify(adaSaid.join(" ").slice(0, 200))}`)
    // The dish is only in the file, so naming it means ada read the file.
    if (!adaSaid.join(" ").toLowerCase().includes(dish)) throw new VerifyError(`ada never named ${dish}, so she did not read the file. she said: ${JSON.stringify(adaSaid)}`)
    room.raw.close()
  },
}

export default suite
