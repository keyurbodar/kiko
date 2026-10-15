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

    const group = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: group, title: "kiko, ada", agents: ["yuki", agentId] } })
    await user.expect(chat(group))
    const again = newRoomId()
    user.send({ t: "chat", op: { op: "create", roomId: again, title: "kiko, ada again", agents: [agentId, "yuki", agentId] } })
    const groupRefused = await user.expect((f) => f.t === "chat_refused")
    expectEqual(groupRefused, { t: "chat_refused", roomId: again, existing: group }, "a group with the same agents is refused")
    await user.expectNone(chat(again), 500)
    console.log(`  group: ${again} refused in another order, ${group} kept`)

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
    user.send({ t: "chat", op: { op: "delete", roomId: dm } })
    await user.expect(gone(dm))
    await Bun.sleep(300)
    expectEqual((await snapshot()).lastChat, kiko.roomId, "a deleted chat falls back to the kiko chat")
    console.log(`  resume: ${dm}, then the kiko chat once it is deleted`)

    user.send({ t: "chat", op: { op: "delete", roomId: group } })
    await user.expect(gone(group))
  },
}

export default suite
