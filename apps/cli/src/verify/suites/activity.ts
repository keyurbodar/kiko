import { newRoom, poll } from "../kit"
import { type Chat, humanHandle, type MessageId, type RoomToClient, type UserToClient } from "@kiko/protocol"
import type { UserChannel } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

function rowOf(user: UserChannel, roomId: string): Chat | undefined {
  let row: Chat | undefined
  for (const entry of user.log) {
    const frame = entry.frame as UserToClient
    if (entry.dir !== "in") continue
    if (frame.t === "events") for (const e of frame.events) if (e.t === "chat" && e.chat.roomId === roomId) row = e.chat
    if (frame.t === "reset") row = frame.snapshot.chats.find((c) => c.roomId === roomId) ?? row
  }
  return row
}

const suite: Suite = {
  name: "activity",
  async run(v) {
    const s = await v.as("activity")
    const handle = humanHandle(s.name)
    const user = await s.user()
    const { roomId, room } = await newRoom(s, "activity")
    const res = await fetch(new URL("api/dev/agent/fake", v.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: s.auth },
      body: JSON.stringify({ roomId, slugs: ["kiko", "ada"] }),
    })
    if (!res.ok) throw new VerifyError(`the fake agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
    const current = (): Chat => {
      const row = rowOf(user, roomId)
      if (!row) throw new VerifyError(`no chat row for ${roomId} yet`)
      return row
    }
    const step = (what: string) => console.log(`  ok ${what}`)
    const wait = (what: string, test: (c: Chat) => boolean, ms = 15_000) =>
      poll(what, () => {
        const row = rowOf(user, roomId)
        return !!row && test(row)
      }, ms)
    const send = async (text: string): Promise<MessageId> => {
      const clientId = room.send(text)
      return ((await room.expect({ t: "ack", clientId })) as Extract<RoomToClient, { t: "ack" }>).id
    }

    try {
      await send("[reply] hello back")
      await wait("the human's message as the line", (c) => c.last?.from === "human" && c.last.text === "[reply] hello back", 5_000)
      step(`the human's message is the line at once: ${JSON.stringify(current().last)}`)
      await wait("the agent's answer as the line", (c) => c.last?.from === "agent" && c.last.text === "hello back")
      expectEqual(current().group, undefined, "group on a dm")
      expectEqual(current().last?.kind, "text", "the answer's kind")
      step(`the agent's answer replaced it, as a dm: ${JSON.stringify(current().last)}`)

      room.raw.send({ t: "member", op: { op: "add", slug: "ada" as never, name: "Ada" } })
      await wait("the join", (c) => c.group === true && c.last?.kind === "joined" && c.last.name === "Ada", 5_000)
      step(`a join made it a group: ${JSON.stringify(current().last)}`)

      const asked = await send("[reply] one")
      await wait("the answer to one", (c) => c.last?.text === "one")
      const before = current().mentions ?? 0
      await send(`[reply] [reply:${asked}] answering you`)
      await wait("the reply as a mention", (c) => c.last?.text === "answering you" && (c.mentions ?? 0) === before + 1)
      step(`an inline reply to the human counts: mentions ${current().mentions}`)
      await send(`[reply] hey @${handle} look`)
      await wait("the @handle as a mention", (c) => c.last?.text === `hey @${handle} look` && (c.mentions ?? 0) === before + 2)
      expectEqual(current().last?.name, "Kiko", "who said it, by name")
      step(`@${handle} counts: mentions ${current().mentions}, line ${JSON.stringify(current().last)}`)

      const unreadRow = current()
      const seq = Math.max(...room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? (e.frame as Extract<RoomToClient, { t: "events" }>).events.map((x) => x.seq) : [])))
      room.raw.send({ t: "read", seq })
      await wait("the read", (c) => c.unread === 0 && c.mentions === undefined, 5_000)
      expectEqual(current().updatedAt, unreadRow.updatedAt, "updatedAt after reading")
      expectEqual(current().last, unreadRow.last, "the line after reading")
      step("reading cleared the mentions and the unread count and kept the row in place")

      await send("[reply] [react:❤️]")
      await wait("the reaction as the line", (c) => c.last?.kind === "react" && c.last.emoji === "❤️")
      expectEqual(current().last?.text, "[reply] [react:❤️]", "the quoted message")
      step(`a reaction is the line: ${JSON.stringify(current().last)}`)

      const typing = user.log.flatMap((e) => (e.dir === "in" && (e.frame as UserToClient).t === "typing" ? [e.frame as Extract<UserToClient, { t: "typing" }>] : []))
      if (!typing.some((f) => f.roomId === roomId && f.names.includes("Kiko"))) throw new VerifyError(`no typing frame named Kiko: ${JSON.stringify(typing)}`)
      if (!typing.some((f) => f.roomId === roomId && f.names.length === 0)) throw new VerifyError("no typing frame ended the typing")
      step(`the user socket said who was typing: ${typing.length} frames`)
    } catch (e) {
      console.log(`  row: ${JSON.stringify(rowOf(user, roomId))}`)
      throw e
    }
  },
}

export default suite
