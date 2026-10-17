import { poll } from "../kit"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { agentSends, bubbles, team } from "./team-loops"


const suite: Suite = {
  name: "team-ask",
  async run(v) {
    const s = await v.as("team-ask")
    const { room, received } = await team(v, s, ["ana", "ben"], "message and answer")
    await room.send("@ana [ask ben] [question] which port does the server use?")
    await poll("ben's answer", () => agentSends(room).some((m) => m.from.kind === "agent" && m.from.slug === "ben"), 30_000)
    await poll("ana's reply after the answer", () => bubbles(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ana").some((m) => m.text.includes("[answer] 42")), 30_000)
    const ana = bubbles(room).filter((m) => m.from.kind === "agent" && m.from.slug === "ana")
    expectEqual(ana.length, 2, "ana's runs: the message, then the answer")
    if (ana[0]?.text.includes("@ben answered:")) throw new VerifyError(`ana's first run waited for ben: ${JSON.stringify(ana[0]?.text)}`)
    const sends = agentSends(room).map((m) => `${m.from.kind === "agent" ? m.from.slug : ""}: ${m.text}`)
    expectEqual(sends, ["ana: @ben [question] which port does the server use?", "ben: @ana [answer] 42"], "the messages in the chat")
    expectEqual(await received(), 3, "envelopes the two inboxes stored")
    console.log(`  ok ana messaged ben without waiting, and his answer came back as its own delivery: ${JSON.stringify(ana.at(-1)?.text.trim().slice(0, 120))}`)
  },
}

export default suite
