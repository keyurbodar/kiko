import type { Message, RoomToClient, UserToClient } from "@kiko/protocol"
import { connectKernel, closeBrowser, kernelKey } from "../browser-kit"
import { connectTestModel, VerifyError, type RoomHandle, type Session } from "../client"
import { dev } from "../routine-kit"
import type { Suite } from "../runner"

const ASK = "share me link so i can see you live"
const LINK = /\[[^\]]+\]\((https:\/\/[^)\s]+)\)/

async function kikoRoom(s: Session): Promise<{ room: RoomHandle; roomId: string }> {
  const user = await s.user()
  const home = (await user.expect((f) => f.t === "reset")) as Extract<UserToClient, { t: "reset" }>
  const chat = home.snapshot.chats.find((c) => c.kiko)
  if (!chat) throw new VerifyError("no kiko chat in the snapshot")
  const room = await s.room(chat.roomId)
  room.raw.send({ t: "model", ref: process.env.KIKO_BROWSER_MODEL ?? "opencode-go/muse-spark-1.3-contributor" })
  await Bun.sleep(500)
  return { room, roomId: chat.roomId }
}

/** The agent's bubbles until it goes idle, a link arrives, or 40 s pass without a new one (a worker keeps the room busy long after Kiko answered). */
async function say(room: RoomHandle, text: string): Promise<string> {
  const clientId = room.send(text)
  await room.expect({ t: "ack", clientId })
  let reply = ""
  for (;;) {
    const f = await room.expect((x) => (x.t === "status" && x.state === "idle" && reply !== "") || (x.t === "events" && x.events.some((e) => e.t === "message" && e.from.kind === "agent")), reply ? 40_000 : 170_000).catch(() => undefined)
    if (!f || f.t === "status") return reply
    for (const e of (f as Extract<RoomToClient, { t: "events" }>).events) if (e.t === "message" && e.from.kind === "agent") reply += `${(e as Message).text}\n`
    if (LINK.test(reply)) return reply
  }
}

async function tools(v: { url: string }, s: Session, roomId: string): Promise<string> {
  const trace = (await dev(v.url, s, "trace", { roomId })) as { kind: string; tool?: string; text?: string }[]
  const link = (i: number) => `browser_link -> ${(trace[i + 1]?.text ?? "").slice(0, 160).replace(/https:\/\/\S+/, "<url>")}`
  return trace.flatMap((t, i) => (t.tool === "browser_link" ? [link(i)] : t.tool ? [t.tool] : [])).join(", ")
}

const suite: Suite = {
  name: "browser-link",
  model: true,
  human: true,
  async run(v) {
    kernelKey()
    const failures: string[] = []
    const check = (name: string, reply: string, called: string) => {
      console.log(`  [${name}] tools called: ${called || "(none)"}\n  [${name}] reply: ${reply.replace(/\n/g, " / ")}`)
      if (!LINK.test(reply)) failures.push(`${name}: no watch link in the reply`)
    }
    const stamp = Date.now().toString(36)

    const fresh = await v.as(`browser-link-fresh-${stamp}`)
    try {
      await connectTestModel(fresh)
      await connectKernel(fresh)
      const { room, roomId } = await kikoRoom(fresh)
      check("fresh chat", await say(room, ASK), await tools(v, fresh, roomId))
    } finally {
      await closeBrowser(v, fresh)
    }

    const busy = await v.as(`browser-link-worker-${stamp}`)
    try {
      await connectTestModel(busy)
      await connectKernel(busy)
      const { room, roomId } = await kikoRoom(busy)
      room.send("check the top YouTube Shorts trends in the browser")
      await Bun.sleep(20_000)
      check("while a worker runs", await say(room, ASK), await tools(v, busy, roomId))
    } finally {
      await closeBrowser(v, busy)
    }

    const refused = await v.as(`browser-link-refused-${stamp}`)
    try {
      await connectTestModel(refused)
      const { room, roomId } = await kikoRoom(refused)
      console.log(`  [after a refusal] before the key: ${(await say(room, ASK)).replace(/\n/g, " / ")}`)
      await connectKernel(refused)
      check("after a refusal", await say(room, ASK), await tools(v, refused, roomId))
    } finally {
      await closeBrowser(v, refused)
    }
    if (failures.length) throw new VerifyError(failures.join("; "))
  },
}

export default suite
