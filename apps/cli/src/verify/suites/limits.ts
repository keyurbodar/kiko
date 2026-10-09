import type { Message, RoomToClient } from "@yuki/protocol"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, send, until } from "./mid-run"

// P9-01, architecture section 17.7. With the turn limit at 2, the third burst gets a limit line and
// no run; raising the record lets the next burst through. Fake agent, no tokens. Needs a dev server.

const suite: Suite = {
  name: "limits",
  async run(v) {
    const s = await v.as(`limits-${Date.now().toString(36)}`)
    const setLimits = async (limits: Record<string, unknown>) => {
      const res = await fetch(new URL("api/dev/agent/limits", v.url.endsWith("/") ? v.url : `${v.url}/`), {
        method: "POST",
        headers: { "content-type": "application/json", cookie: s.cookie },
        body: JSON.stringify({ limits }),
      })
      if (!res.ok) throw new VerifyError(`the limits route answered ${res.status}`)
    }
    const { roomId, room } = await newRoom(s, "limits")
    await fake(v, s, roomId)
    await setLimits({ turnsPerDay: 2 })
    const messages = () => {
      const all = new Map<string, Message>()
      for (const e of room.raw.log) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const x of f.events) if (x.t === "message") all.set(x.id, x)
      }
      return [...all.values()]
    }
    const agentReplies = () => messages().filter((m) => m.from.kind === "agent").length
    const limitLines = () => messages().filter((m) => m.from.kind === "system" && /today's 2 replies/.test(m.text))
    for (const [i, text] of ["one.", "two.", "three."].entries()) {
      await send(room, `[reply] ${text}`)
      if (i < 2) await until(`reply ${i + 1}`, () => agentReplies() === i + 1, 20_000)
    }
    await until("the limit line", () => limitLines().length === 1, 20_000)
    await Bun.sleep(3_000)
    if (agentReplies() !== 2) throw new VerifyError(`the third burst got a reply: ${agentReplies()} replies`)
    console.log(`  ok the third burst got: ${JSON.stringify(limitLines()[0]!.text)} and no run`)
    await setLimits({ turnsPerDay: 10 })
    await send(room, "[reply] four.")
    await until("the reply after raising the limit", () => agentReplies() === 3, 20_000)
    console.log("  ok raising the record let the next burst through")
    room.raw.close()
  },
}

export default suite
