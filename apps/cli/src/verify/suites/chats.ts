import { type Chat, isRoomId, newRoomId, type RoomId, type UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"


const suite: Suite = {
  name: "chats",
  async run(v) {
    const s = await v.as(`chats-${Date.now().toString(36)}`)
    await fetch(new URL("api/me", v.url), { headers: { cookie: s.cookie } })
    const user = await s.user()
    const first = await user.expect((f) => f.t === "reset")
    if (first.t !== "reset") throw new VerifyError("a new device must get a snapshot")
    const kiko = first.snapshot.chats.find((c) => c.kiko)
    if (!kiko) throw new VerifyError("no kiko chat in the snapshot")
    expectEqual(first.snapshot.lastChat, kiko.roomId, "a user who opened nothing resumes in the kiko chat")

    const chat = (roomId: string) => (f: UserToClient) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId)
    const gone = (roomId: string) => (f: UserToClient) => f.t === "events" && f.events.some((e) => e.t === "chat_removed" && e.roomId === roomId)

    const agentId = `ada-${Date.now().toString(36)}`
    const dm = newRoomId()
    if (!isRoomId(dm) || !/^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(dm)) throw new VerifyError(`not a UUIDv7: ${dm}`)
    user.send({ t: "chat", op: { op: "create", roomId: dm, title: "ada", agents: [agentId] } })
    await user.expect(chat(dm))
    const second = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: second, title: "ada again", agents: [agentId] } })
    const refused = await user.expect((f) => f.t === "chat_refused")
    expectEqual(refused, { t: "chat_refused", roomId: second, existing: dm }, "a second direct chat is refused")
    await user.expectNone(chat(second), 500)
    console.log(`  one dm: ${second} refused, ${dm} kept`)

    user.send({ t: "chat", op: { op: "pin", roomId: kiko.roomId, pinned: false } })
    user.send({ t: "chat", op: { op: "delete", roomId: kiko.roomId } })
    await user.expectNone((f) => chat(kiko.roomId)(f) || gone(kiko.roomId)(f), 800)
    console.log("  kiko: unpin and delete changed nothing")

    const temp = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: temp, title: "new chat", agents: ["yuki"], temp: true } })
    await user.expect(chat(temp))
    user.send({ t: "chat", op: { op: "delete", roomId: temp } })
    await user.expect(gone(temp))
    const group = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: group, title: "new chat", agents: ["yuki"], temp: true } })
    await user.expect(chat(group))
    user.send({ t: "chat", op: { op: "keep", roomId: group, title: "kiko, ada", agents: ["yuki", agentId] } })
    const kept = await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === group && !e.chat.temp))
    const keptChat = kept.t === "events" ? kept.events.flatMap((e) => (e.t === "chat" && e.chat.roomId === group ? [e.chat] : []))[0] : undefined
    expectEqual(keptChat?.title, "kiko, ada", "the kept group's title")
    console.log(`  temp: ${temp} deleted on close, ${group} kept as a group`)

    const snapshot = async (): Promise<{ lastChat?: RoomId; chats: readonly Chat[] }> => {
      const device = await s.user()
      const f = await device.expect((x) => x.t === "reset")
      device.close()
      if (f.t !== "reset") throw new VerifyError("a new device must get a snapshot")
      return f.snapshot
    }
    user.send({ t: "open", roomId: dm })
    await Bun.sleep(300)
    expectEqual((await snapshot()).lastChat, dm, "the last chat opened")
    const temp2 = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: temp2, title: "new chat", agents: ["yuki"], temp: true } })
    await user.expect(chat(temp2))
    user.send({ t: "open", roomId: temp2 })
    await Bun.sleep(300)
    const after = await snapshot()
    expectEqual(after.lastChat, kiko.roomId, "a temporary chat is never resumed")
    console.log(`  resume: ${dm}, then the kiko chat after a temporary one`)

    for (const roomId of [dm, group, temp2]) user.send({ t: "chat", op: { op: "delete", roomId } })
    await user.expect(gone(temp2))
  },
}

export default suite
