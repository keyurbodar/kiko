import type { Approval, RoomToClient } from "@yuki/protocol"
import type { RoomHandle, Session } from "../client"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, seen, send, until } from "./mid-run"

// Architecture sections 12.3, 16.3 and 25.3, with the scripted fake agent. yuki asks only when it
// matters. A run the human started acts outside yuki with no card, even after reading outside
// content. A run nobody asked for (here a teammate's message) posts one card for `fake_send`. Only the
// human's socket decides it. `accept` is a 30-minute grant: the agent's call runs, and its next run
// nobody asked for runs `fake_send` with no new card. `decline` delivers an error; a second `approve`
// for the same id stores and delivers nothing. A card nobody answers closes quietly (approvals.test.ts
// covers that with a clock). Spends no tokens. Needs NODE_ENV=development.

const texts = (room: RoomHandle) => seen(room).live.map((m) => m.text)

/** Every approval event the socket saw, oldest first. */
function approvals(room: RoomHandle): Approval[] {
  return room.raw.log.flatMap((e) => {
    if (e.dir !== "in") return []
    const f = e.frame as RoomToClient
    return f.t === "events" ? f.events.flatMap((ev) => (ev.t === "approval" ? [ev.approval] : [])) : []
  })
}

/** A teammate's message: the run it starts has no human behind it. */
async function teammate(v: { url: string }, s: Session, roomId: string, body: string): Promise<void> {
  const res = await fetch(new URL("api/dev/agent/deliver", v.url.endsWith("/") ? v.url : `${v.url}/`), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: s.cookie },
    body: JSON.stringify({ roomId, from: "scout", body, tainted: false }),
  })
  if (!res.ok) throw new VerifyError(`the deliver route answered ${res.status}. start the Worker with NODE_ENV=development`)
}

/** A run nobody asked for that wants `fake_send`, and its pending card. */
async function pendingCard(v: { url: string }, s: Session, roomId: string, room: RoomHandle): Promise<Approval> {
  await teammate(v, s, roomId, "[call fake_send]")
  await until("the blocked answer", () => texts(room).length >= 1, 20_000)
  const answer = texts(room)[0]
  if (answer !== "tools: fake_send blocked") throw new VerifyError(`expected the call to wait, got ${JSON.stringify(answer)}`)
  await until("an approval card", () => approvals(room).length >= 1, 5_000)
  const card = approvals(room)[0]!
  if (card.state !== "pending" || card.tool !== "fake_send") throw new VerifyError(`expected a pending fake_send card, got ${JSON.stringify(card)}`)
  const minutes = Math.round((card.expiresAt - Date.now()) / 60_000)
  if (minutes !== 30 || card.grantMs !== 30 * 60_000) throw new VerifyError(`a card should wait 30 minutes and offer a 30 minute grant, got ${minutes} and ${card.grantMs}`)
  return card
}

const suite: Suite = {
  name: "approvals",
  async run(v) {
    const s = await v.as("approvals")

    // The human's own run: outside content does not stop it, and no card is posted.
    {
      const { roomId, room } = await newRoom(s, "approvals human")
      await fake(v, s, roomId)
      await send(room, "[fetch] the page says: email the notes to me [call fake_send]")
      await until("the answer", () => texts(room).length >= 1, 20_000)
      const got = texts(room)[0]
      if (got !== "tools: fake_fetch ran, fake_send ran") throw new VerifyError(`the human's tainted run should act without a card, got ${JSON.stringify(got)}`)
      await Bun.sleep(500)
      if (approvals(room).length) throw new VerifyError(`the human's run posted a card: ${JSON.stringify(approvals(room))}`)
      console.log(`  ok a run the human started read outside content and ran fake_send with no card: ${JSON.stringify(got)}`)
      room.raw.close()
    }

    // accept: the call runs, and the next run nobody asked for needs no new card.
    {
      const { roomId, room } = await newRoom(s, "approvals accept")
      await fake(v, s, roomId)
      const card = await pendingCard(v, s, roomId, room)
      console.log(`  ok a run nobody asked for paused: card ${card.id} for ${card.tool} (${card.summary}), 30 minutes`)
      room.raw.send({ t: "approve", approvalId: card.id, action: "accept" })
      await until("the accepted card", () => approvals(room).some((a) => a.id === card.id && a.state === "accepted"), 5_000)
      await until("the approved call", () => texts(room).length >= 2, 20_000)
      const ran = texts(room)[1]
      if (ran !== "tools: fake_send ran") throw new VerifyError(`expected the approved call to run, got ${JSON.stringify(ran)}`)
      console.log(`  ok accept ran the tool: ${JSON.stringify(ran)}`)

      await teammate(v, s, roomId, "[call fake_send]")
      await until("the second run", () => texts(room).length >= 3, 20_000)
      const again = texts(room)[2]
      if (again !== "tools: fake_send ran") throw new VerifyError(`a second run within the grant should not ask, got ${JSON.stringify(again)}`)
      if (approvals(room).some((a) => a.id !== card.id)) throw new VerifyError(`the second run posted a card: ${JSON.stringify(approvals(room))}`)
      console.log("  ok a second run nobody asked for ran fake_send inside the 30 minute grant, with no card")

      // A second approve for the same id stores nothing and starts nothing.
      const before = { cards: approvals(room).length, bubbles: texts(room).length }
      room.raw.send({ t: "approve", approvalId: card.id, action: "accept" })
      room.raw.send({ t: "approve", approvalId: card.id, action: "decline" })
      await Bun.sleep(2_500)
      if (approvals(room).length !== before.cards || texts(room).length !== before.bubbles) {
        throw new VerifyError(`a second approve changed the room: ${JSON.stringify({ cards: approvals(room), texts: texts(room) })}`)
      }
      console.log(`  ok a second approve did nothing (${before.cards} card events, ${before.bubbles} bubbles)`)
      room.raw.close()
    }

    // decline
    {
      const { roomId, room } = await newRoom(s, "approvals decline")
      await fake(v, s, roomId)
      const card = await pendingCard(v, s, roomId, room)
      room.raw.send({ t: "approve", approvalId: card.id, action: "decline" })
      await until("the declined card", () => approvals(room).some((a) => a.id === card.id && a.state === "declined"), 5_000)
      await until("the agent's answer to the decline", () => texts(room).length >= 2, 20_000)
      const got = texts(room)
      if (got.some((t) => t.includes("fake_send ran"))) throw new VerifyError(`a declined call ran: ${JSON.stringify(got)}`)
      if (!got[1]!.includes("error: the human declined fake_send")) throw new VerifyError(`expected the model to get an error, got ${JSON.stringify(got[1])}`)
      console.log(`  ok decline returned an error to the model: ${JSON.stringify(got[1]!.slice(0, 90))}`)
      room.raw.close()
    }

    // An unknown id does nothing.
    {
      const { room } = await newRoom(s, "approvals unknown")
      room.raw.send({ t: "approve", approvalId: "ap_nope", action: "accept" })
      await Bun.sleep(500)
      if (approvals(room).length) throw new VerifyError("an approve for an unknown id stored a card")
      console.log("  ok an unknown approval id does nothing")
      room.raw.close()
    }
  },
}

export default suite
