import { type Chat, humanHandle, type MessageId, type RoomToClient, type UserToClient } from "@yuki/protocol"
import type { UserChannel } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, until } from "./mid-run"

// The chat list's activity line and mentions of the human, against the scripted fake agents of
// `apps/server/src/agent/dev-fake.ts` (`[reply] x` answers exactly `x`), so the suite is
// deterministic and spends no tokens. Needs a development server (`NODE_ENV=development`).
//
//   the human's own message is the row's line at once, from `human`
//   an agent's answer replaces it; a DM has no `group`
//   a member joining makes the chat a group, and the join is the line
//   an agent's reply to a human message, and an agent's `@handle`, each count as a mention
//   reading clears the mentions and the unread count, and does not move the row
//   an agent's reaction to a human message becomes the line
//   the user socket says who is typing in the chat

/** The newest row the user socket has for `roomId`. */
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
    // Both agents are scripted, so their turns cost nothing.
    const res = await fetch(new URL("api/dev/agent/fake", v.url.endsWith("/") ? v.url : `${v.url}/`), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: s.cookie },
      body: JSON.stringify({ roomId, slugs: ["yuki", "ada"] }),
    })
    if (!res.ok) throw new VerifyError(`the fake agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
    const row = () => rowOf(user, roomId)
    const step = (what: string) => console.log(`  ok ${what}`)
    const wait = (what: string, test: (c: Chat) => boolean, ms = 15_000) => until(what, () => !!row() && test(row()!), ms)
    const send = async (text: string): Promise<MessageId> => {
      const clientId = room.send(text)
      return ((await room.expect({ t: "ack", clientId })) as Extract<RoomToClient, { t: "ack" }>).id
    }

    try {
      // 1. Your message, then the agent's answer, in a DM.
      await send("[reply] hello back")
      await wait("the human's message as the line", (c) => c.last?.from === "human" && c.last.text === "[reply] hello back", 5_000)
      step(`the human's message is the line at once: ${JSON.stringify(row()!.last)}`)
      await wait("the agent's answer as the line", (c) => c.last?.from === "agent" && c.last.text === "hello back")
      expectEqual(row()!.group, undefined, "group on a dm")
      expectEqual(row()!.last?.kind, "text", "the answer's kind")
      step(`the agent's answer replaced it, as a dm: ${JSON.stringify(row()!.last)}`)

      // 2. Someone joins: a group, and the join is the line.
      room.raw.send({ t: "member", op: { op: "add", slug: "ada" as never, name: "Ada" } })
      await wait("the join", (c) => c.group === true && c.last?.kind === "joined" && c.last.name === "Ada", 5_000)
      step(`a join made it a group: ${JSON.stringify(row()!.last)}`)

      // 3. Mentions: a reply to the human's message, then an @handle.
      const asked = await send("[reply] one")
      await wait("the answer to one", (c) => c.last?.text === "one")
      const before = row()!.mentions ?? 0
      await send(`[reply] [reply:${asked}] answering you`)
      await wait("the reply as a mention", (c) => c.last?.text === "answering you" && (c.mentions ?? 0) === before + 1)
      step(`an inline reply to the human counts: mentions ${row()!.mentions}`)
      await send(`[reply] hey @${handle} look`)
      await wait("the @handle as a mention", (c) => c.last?.text === `hey @${handle} look` && (c.mentions ?? 0) === before + 2)
      expectEqual(row()!.last?.name, "yuki", "who said it, by name")
      step(`@${handle} counts: mentions ${row()!.mentions}, line ${JSON.stringify(row()!.last)}`)

      // 4. Reading clears both counts and keeps the row where it was.
      const unreadRow = row()!
      const seq = Math.max(...room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? (e.frame as Extract<RoomToClient, { t: "events" }>).events.map((x) => x.seq) : [])))
      room.raw.send({ t: "read", seq })
      await wait("the read", (c) => c.unread === 0 && c.mentions === undefined, 5_000)
      expectEqual(row()!.updatedAt, unreadRow.updatedAt, "updatedAt after reading")
      expectEqual(row()!.last, unreadRow.last, "the line after reading")
      step("reading cleared the mentions and the unread count and kept the row in place")

      // 5. An agent's reaction to the human's message is the line until something newer.
      await send("[reply] [react:❤️]")
      await wait("the reaction as the line", (c) => c.last?.kind === "react" && c.last.emoji === "❤️")
      expectEqual(row()!.last?.text, "[reply] [react:❤️]", "the quoted message")
      step(`a reaction is the line: ${JSON.stringify(row()!.last)}`)

      // 6. The user socket said who was typing in this chat, by name.
      const typing = user.log.flatMap((e) => (e.dir === "in" && (e.frame as UserToClient).t === "typing" ? [e.frame as Extract<UserToClient, { t: "typing" }>] : []))
      if (!typing.some((f) => f.roomId === roomId && f.names.includes("yuki"))) throw new VerifyError(`no typing frame named yuki: ${JSON.stringify(typing)}`)
      if (!typing.some((f) => f.roomId === roomId && f.names.length === 0)) throw new VerifyError("no typing frame ended the typing")
      step(`the user socket said who was typing: ${typing.length} frames`)
    } catch (e) {
      console.log(`  row: ${JSON.stringify(row())}`)
      throw e
    }
  },
}

export default suite
