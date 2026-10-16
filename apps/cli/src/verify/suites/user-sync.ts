import { newRoomId } from "@kiko/protocol"
import type { UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser, UserToClient as UserToClientSchema } from "@kiko/protocol/schema"
import { Channel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { must } from "../must"




const chatEvents = (frame: UserToClient, rooms: string[]): UserEvent[] =>
  frame.t === "events"
    ? frame.events.filter((e) => (e.t === "chat" || e.t === "chat_removed") && rooms.includes(e.t === "chat" ? e.chat.roomId : e.roomId))
    : []

const suite: Suite = {
  name: "user-sync",
  async run(v) {
    const s = await v.as("user-sync")
    const a = await s.user()
    const b = await s.user()
    await a.expect(() => true)
    await b.expect(() => true)

    const one = newRoomId()
    const two = newRoomId()
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
    if (!(must(seqs[0], "seq 0") < must(seqs[1], "seq 1") && must(seqs[1], "seq 1") < must(seqs[2], "seq 2"))) throw new VerifyError(`seq must increase. got ${seqs}`)
    await b.expectNone((f) => chatEvents(f, rooms).length > 0, 400)

    const echoed: UserEvent[] = []
    while (echoed.length < 3) echoed.push(...chatEvents(await a.expect((f) => chatEvents(f, rooms).length > 0), rooms))
    expectEqual(echoed, seen, "events on the sending socket")

    const wsUrl = new URL("api/ws/user", v.url)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const resumed = new Channel(`${s.name}/user resumed`, wsUrl, s.auth, UserToClientSchema, ClientToUser, {
      t: "hello",
      lastSeq: must(seqs[0], "seq 0"),
    })
    try {
      await resumed.connect()
      const first = await resumed.expect(() => true)
      if (first.t !== "events") throw new VerifyError(`a recent lastSeq must replay events, got ${first.t}`)
      expectEqual(first.events, seen.slice(1), "replayed events after lastSeq")
    } finally {
      resumed.close()
    }

    for (const roomId of rooms) a.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
    const removed = new Set<string>()
    while (removed.size < 2) {
      for (const e of chatEvents(await b.expect((f) => chatEvents(f, rooms).length > 0), rooms)) {
        if (e.t === "chat_removed") removed.add(e.roomId)
      }
    }

    // First run is remembered on the server, so a browser that saved nothing does not show it again.
    const settings = async (body?: object) => {
      const res = await fetch(new URL("api/settings", v.url), {
        method: body ? "POST" : "GET",
        headers: { authorization: s.auth, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new VerifyError(`${body ? "POST" : "GET"} api/settings answered ${res.status}`)
      return (await res.json()) as { onboarded?: boolean }
    }
    await settings({ onboarded: true })
    expectEqual((await settings()).onboarded, true, "onboarded after first run ends")
  },
}

export default suite
