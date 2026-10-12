import { poll } from "../kit"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { agentSends, bubbles, team } from "./team-loops"


const suite: Suite = {
  name: "team-ask",
  async run(v) {
    const s = await v.as("team-ask")
    const { room, received } = await team(v, s, ["ana", "ben"], "ask and wait")
    await room.send("@ana [ask ben] [question] which port does the server use?")
    await poll("ana's reply", () => bubbles(room).some((m) => m.from.kind === "agent" && m.from.slug === "ana"), 30_000)
    await Bun.sleep(3_000)
    const ana = bubbles(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ana")
    expectEqual(ana.length, 1, "ana's replies: one run")
    if (!ana[0]?.text.includes("@ben answered: [answer] 42")) throw new VerifyError(`ana's reply does not carry ben's answer: ${JSON.stringify(ana[0]?.text)}`)
    const sends = agentSends(room).map((m) => `${m.from.kind === "agent" ? m.from.slug : ""}: ${m.text}`)
    expectEqual(sends, ["ana: @ben [question] which port does the server use?", "ben: @ana [answer] 42"], "the messages in the chat")
    expectEqual(await received(), 2, "envelopes the two inboxes stored")
    console.log(`  ok ana asked, ben answered, and ana's one reply says: ${JSON.stringify(ana[0]?.text)}`)
  },
}

export default suite
