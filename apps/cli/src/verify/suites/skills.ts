import type { Message, RoomToClient } from "@yuki/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, send, until } from "./mid-run"

// P5-08, architecture section 15. With the test model: a haiku request makes the agent load the
// built-in haiku skill (its sign-off line proves read_skill ran), and a room skill named haiku,
// written to the chat's files, then wins over the built-in one.

const suite: Suite = {
  name: "skills",
  model: true,
  async run(v) {
    const s = await v.as(`skills-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const { roomId, room } = await newRoom(s, "skills")
    const texts = () => {
      const all = new Map<string, Message>()
      for (const e of room.raw.log) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const x of f.events) if (x.t === "message" && x.from.kind === "agent") all.set(x.id, x)
      }
      return [...all.values()].map((m) => m.text.toLowerCase())
    }
    await send(room, "write me a haiku about rain please.")
    await until("the built-in skill's sign-off", () => texts().some((t) => t.includes("haiku by yuki's haiku skill")), 90_000)
    console.log("  ok the built-in haiku skill was loaded and followed")

    room.raw.close()

    // A fresh chat with a room skill named haiku: the room's copy wins over the built-in one.
    const second = await newRoom(s, "skills, room override")
    const skill = "---\nname: haiku\ndescription: write a haiku when the human asks for one.\n---\nwrite three short lines. then add one more bubble that reads exactly: room haiku wins\n"
    const res = await s.putFile(second.roomId, "skills/haiku/SKILL.md", skill, { type: "text/markdown" })
    if (!res.ok) throw new VerifyError(`writing the room skill answered ${res.status}`)
    const texts2 = () => {
      const all = new Map<string, Message>()
      for (const e of second.room.raw.log) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const x of f.events) if (x.t === "message" && x.from.kind === "agent") all.set(x.id, x)
      }
      return [...all.values()].map((m) => m.text.toLowerCase())
    }
    await send(second.room, "write me a haiku about the sun please.")
    await until("the room skill's sign-off", () => texts2().some((t) => t.includes("room haiku wins")), 90_000)
    if (texts2().some((t) => t.includes("haiku by yuki's haiku skill"))) throw new VerifyError("the built-in haiku skill ran in a room that has its own")
    console.log("  ok the room skill named haiku won over the built-in one")
    second.room.raw.close()
  },
}

export default suite
