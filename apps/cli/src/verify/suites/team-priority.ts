import type { Message } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send, until } from "./mid-run"
import { agentSends, bubbles, dev, messages, notices, settle, team } from "./team-loops"

// P6-06, architecture section 7.8. Two fake agents (apps/server/src/agent/dev-fake.ts) echo each
// other forever. No tokens. Needs a development server.
//
//   priority  a human message sent mid-exchange is answered before the agent message that waited
//   stop      stop ends both runs, clears both inboxes, and no agent message is sent after it

const slugOf = (m: Message) => (m.from.kind === "agent" ? m.from.slug : "")
type Status = { inbox: { waiting: number; claimed: number; submitted: number } }

const suite: Suite = {
  name: "team-priority",
  async run(v) {
    const s = await v.as("team-priority")
    const slugs = ["ana", "ben"]
    const { room, received, roomId } = await team(v, s, slugs, "priority")

    // 1. ana is the lead. The echo chain runs between ana and ben until the human speaks.
    await send(room, "[send ben] [echo]")
    await until("ben's first echo", () => agentSends(room).some((m) => slugOf(m) === "ben"), 30_000)
    await send(room, "[reply] human first")
    const human = messages(room).find((m) => m.from.kind === "human" && m.text === "[reply] human first")
    if (!human) throw new VerifyError("the human message never came back")
    await until("ana's answer to the human", () => bubbles(room).some((m) => m.text === "human first"), 30_000)
    // Every ana bubble after the human message, up to the answer. Only the run that was already
    // answering may finish first. An agent message that waited must not be answered before the human.
    const after = bubbles(room).filter((m) => slugOf(m) === "ana" && m.seq > human.seq)
    const before = after.slice(0, after.findIndex((m) => m.text === "human first"))
    if (before.length > 1) throw new VerifyError(`ana answered ${before.length} agent turns before the human: ${JSON.stringify(before.map((m) => m.text))}`)
    console.log(`  ok priority: ana answered the human after ${before.length} run(s) already in flight`)

    // 2. The human message started a new chain. Stop it mid-exchange.
    const sendsBefore = agentSends(room).length
    await until("the new chain", () => agentSends(room).length >= sendsBefore + 2, 30_000)
    if (notices(room).length) throw new VerifyError("the loop hit its limit before stop was sent")
    room.raw.send({ t: "stop" })
    const stoppedAt = Date.now()
    // A send stored before the room handled stop may still arrive. Then nothing more.
    await Bun.sleep(1_000)
    const sendsAtStop = agentSends(room).length
    const receivedAtStop = await received()
    await settle(() => messages(room).length, 4_000, 20_000)
    expectEqual(agentSends(room).length, sendsAtStop, "agent messages sent after stop")
    expectEqual(await received(), receivedAtStop, "envelopes the inboxes stored after stop")
    expectEqual(notices(room).length, 0, "loop limit notices (the chain ended at stop)")
    for (const slug of slugs) {
      const st = (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status & { tasks: number; submissions: number }
      expectEqual({ waiting: st.inbox.waiting, claimed: st.inbox.claimed, tasks: st.tasks, submissions: st.submissions }, { waiting: 0, claimed: 0, tasks: 0, submissions: 0 }, `${slug} after stop`)
    }
    console.log(`  ok stop: quiet ${((Date.now() - stoppedAt) / 1000).toFixed(1)}s, ${sendsAtStop} agent messages in all, both inboxes empty, no run live`)

    // 3. A human message after stop starts fresh.
    await send(room, "@ben [reply] back again")
    await until("ben's answer after stop", () => bubbles(room).some((m) => m.text === "back again"), 15_000)
    console.log("  ok after stop: ben answers the next human message")
    room.raw.close()
  },
}

export default suite
