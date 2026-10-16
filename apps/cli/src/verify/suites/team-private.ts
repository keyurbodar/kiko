import { newRoomId, pairRoomId } from "@kiko/protocol"
import type { Agent, AgentSlug, RoomId } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import { messages, poll } from "../kit"
import type { Suite } from "../runner"
import { send } from "./mid-run"
import { agentSends, bubbles, dev } from "./team-loops"

const agentOf = (slug: string): Agent => ({ id: `team-private-${slug}`, name: slug, slug: slug as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })
const line = (m: { from: { kind: string; slug?: string }; text: string }) => `${m.from.slug ?? m.from.kind}: ${m.text}`

const suite: Suite = {
  name: "team-private",
  async run(v) {
    const s = await v.as(`team-private-${Date.now().toString(36)}`)
    const user = await s.user()
    for (const slug of ["ana", "ben"]) user.send({ t: "agent", op: { op: "create", agent: agentOf(slug) } })
    const roomId = newRoomId() as RoomId
    user.send({ t: "chat", op: { op: "create", roomId, title: "private talk", agents: [agentOf("ana").id] } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    const pair = pairRoomId("ana", "ben")
    await dev(v.url, s.auth, "fake", { roomId, slugs: ["ana"] })
    await dev(v.url, s.auth, "fake", { roomId: pair, slugs: ["ana", "ben"] })

    await send(room, "@ana [ask ben] [question] which port does the server use?")
    await poll("ana's reply", () => bubbles(room).some((m) => m.from.kind === "agent" && m.from.slug === "ana"), 30_000)
    const reply = bubbles(room).find((m) => m.from.kind === "agent" && m.from.slug === "ana")
    if (!reply?.text.includes("@ben answered: [answer] 42")) throw new VerifyError(`ana's reply does not carry ben's answer: ${JSON.stringify(reply?.text)}`)
    expectEqual(agentSends(room).map(line), ["ana: @ben [question] which port does the server use?", "ben: @ana [answer] 42"], "the messages in the origin chat")
    console.log("  ok ana asked ben, who is not in the chat, and got his answer as the tool result")

    await send(room, "@ana [send ben] [question] and the database?")
    await poll("ben's second answer", () => agentSends(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ben").length === 2, 30_000)
    expectEqual(agentSends(room).length, 4, "the origin chat now holds two exchanges")

    const reset = await (async () => {
      const other = await s.room(roomId)
      other.raw.sendRaw(JSON.stringify({ t: "hello", lastSeq: 1_000_000_000 }))
      const f = await other.expect((x) => x.t === "reset", 5_000)
      other.raw.close()
      if (f.t !== "reset") throw new VerifyError("no snapshot")
      return f.snapshot
    })()
    expectEqual(reset.members.map((m) => m.slug), ["ana"], "the origin members")

    const fresh = await s.user()
    const snapshot = await fresh.expect((f) => f.t === "reset", 5_000)
    if (JSON.stringify(snapshot).includes(pair)) throw new VerifyError("the pair chat is in the user's snapshot")
    const talk = await s.room(pair)
    await poll("the pair room's log", () => messages(talk).length >= 4, 10_000)
    expectEqual(agentSends(talk).map(line), [
      "ana: @ben [question] which port does the server use?",
      "ben: @ana [answer] 42",
      "ana: @ben [question] and the database?",
      "ben: @ana [answer] 42",
    ], "the pair room log")
    console.log("  ok the talk ran in one pair room, the origin never gained ben, and the chat list never held the pair")
    talk.raw.close()
    room.raw.close()
  },
}

export default suite
