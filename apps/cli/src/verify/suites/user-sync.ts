import type { UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser, UserToClient as UserToClientSchema } from "@kiko/protocol/schema"
import { Channel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P1-05. One device edits the chat list and a second device sees every change live,
// once and in order. Then the second device reconnects from a sequence it saw and
// gets only what came after.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A fresh room id. 10 time characters and 16 random ones, as a ULID. */
function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  const random = crypto.getRandomValues(new Uint8Array(16))
  return head + Array.from(random, (b) => CROCKFORD[b % 32]).join("")
}

const chatEvents = (frame: UserToClient, rooms: string[]): UserEvent[] =>
  frame.t === "events"
    ? frame.events.filter((e) => e.t !== "theme" && rooms.includes(e.t === "chat" ? e.chat.roomId : e.roomId))
    : []

const suite: Suite = {
  name: "user-sync",
  async run(v) {
    const s = await v.as("user-sync")
    const a = await s.user()
    const b = await s.user()
    // Both devices are caught up before any edit, so what follows is live.
    await a.expect(() => true)
    await b.expect(() => true)

    const one = ulid()
    const two = ulid()
    const rooms = [one, two]
    a.send({ t: "chat", op: { op: "create", roomId: one as never, title: "first chat" } })
    a.send({ t: "chat", op: { op: "create", roomId: two as never, title: "second chat" } })
    a.send({ t: "chat", op: { op: "rename", roomId: one as never, title: "renamed chat" } })

    const seen: UserEvent[] = []
    while (seen.length < 3) seen.push(...chatEvents(await b.expect((f) => chatEvents(f, rooms).length > 0), rooms))
    const summary = seen.map((e) => (e.t === "chat" ? [e.chat.roomId, e.chat.title] : e.t === "chat_removed" ? [e.roomId, "removed"] : [e.t, ""]))
    expectEqual(
      summary,
      [
        [one, "first chat"],
        [two, "second chat"],
        [one, "renamed chat"],
      ],
      "events on the second socket",
    )
    const seqs = seen.map((e) => e.seq)
    if (!(seqs[0]! < seqs[1]! && seqs[1]! < seqs[2]!)) throw new VerifyError(`seq must increase. got ${seqs}`)
    await b.expectNone((f) => chatEvents(f, rooms).length > 0, 400)

    // The sending device gets the same events, so it can drop its optimistic patches.
    const echoed: UserEvent[] = []
    while (echoed.length < 3) echoed.push(...chatEvents(await a.expect((f) => chatEvents(f, rooms).length > 0), rooms))
    expectEqual(echoed, seen, "events on the sending socket")

    // Resume: a device that applied the first event gets exactly the two after it.
    const wsUrl = new URL("api/ws/user", v.url.endsWith("/") ? v.url : `${v.url}/`)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const resumed = new Channel(`${s.name}/user resumed`, wsUrl, s.cookie, UserToClientSchema, ClientToUser, {
      t: "hello",
      lastSeq: seqs[0]!,
    })
    try {
      await resumed.connect()
      const first = await resumed.expect(() => true)
      if (first.t !== "events") throw new VerifyError(`a recent lastSeq must replay events, got ${first.t}`)
      expectEqual(first.events, seen.slice(1), "replayed events after lastSeq")
    } finally {
      resumed.close()
    }

    // Clean up, so repeated runs do not grow the chat list.
    for (const roomId of rooms) a.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
    const removed = new Set<string>()
    while (removed.size < 2) {
      for (const e of chatEvents(await b.expect((f) => chatEvents(f, rooms).length > 0), rooms)) {
        if (e.t === "chat_removed") removed.add(e.roomId)
      }
    }
  },
}

export default suite
