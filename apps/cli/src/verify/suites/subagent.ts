import type { RoomHandle, Session } from "../client"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, seen, send, statuses, until } from "./mid-run"

// P6-05, architecture section 8. With the test model: the agent delegates with spawn_subagent,
// the helper's answer comes back as the tool result, and the agent replies with it. The room
// holds one child conversation for the call.
//
// Restart check: set KIKO_SUBAGENT_RESTART to a shell command that stops the dev server and
// starts it again, returning once it is healthy. The suite runs it as soon as the child exists,
// reconnects, and must still end with exactly one child, not two. Needs NODE_ENV=development.

const RESTART = process.env.KIKO_SUBAGENT_RESTART

async function children(url: string, s: Session, roomId: string): Promise<{ id: string; taskId: string }[]> {
  const res = await fetch(new URL(`api/dev/agent/children?roomId=${roomId}`, url.endsWith("/") ? url : `${url}/`), { headers: { cookie: s.cookie } })
  if (!res.ok) throw new VerifyError(`the children route answered ${res.status}. start the Worker with NODE_ENV=development`)
  return ((await res.json()) as { children: { id: string; taskId: string }[] }).children
}

async function reconnect(room: RoomHandle): Promise<void> {
  const end = Date.now() + 60_000
  for (;;) {
    try {
      return await room.reconnect()
    } catch (e) {
      if (Date.now() > end) throw e
      await Bun.sleep(500)
    }
  }
}

const suite: Suite = {
  name: "subagent",
  model: true,
  async run(v) {
    const s = await v.as("subagent")
    await connectTestModel(s)
    const { roomId, room } = await newRoom(s, "subagent")
    const step = (what: string) => console.log(`  ok ${what}`)
    try {
      await send(room, "call the spawn_subagent tool once with the task: name three prime numbers below 10. then reply with only the numbers it gave you.")
      const end = Date.now() + 90_000
      let found: { id: string; taskId: string }[] = []
      while (!found.length && Date.now() < end) {
        await Bun.sleep(500)
        found = await children(v.url, s, roomId).catch(() => [])
      }
      if (!found.length) throw new VerifyError("the agent never spawned a helper")
      step("the agent called spawn_subagent and a child conversation exists")
      if (RESTART) {
        Bun.spawnSync(["sh", "-c", RESTART], { stdout: "inherit", stderr: "inherit" })
        await reconnect(room)
        step("the server restarted while the helper ran")
      }
      await until("an answer", () => seen(room).live.length > 0 && statuses(room).at(-1) === "idle", 120_000)
      const text = seen(room).live.map((m) => m.text).join(" ")
      const primes = (text.match(/\b[2357]\b/g) ?? []).length
      if (primes < 3) throw new VerifyError(`the reply did not carry the helper's primes: ${JSON.stringify(text)}`)
      step(`the helper's answer came back and the agent replied: ${JSON.stringify(text.slice(0, 80))}`)
      expectEqual((await children(v.url, s, roomId)).length, 1, "child conversations")
      step("exactly one child conversation")

      // A helper can recall the chat's memory, so it finds what was said before it existed.
      const before = seen(room).live.length
      await send(room, "the code word for this chat is marigold-42. just say ok.")
      await until("an ok", () => seen(room).live.length > before && statuses(room).at(-1) === "idle", 120_000)
      const after = seen(room).live.length
      await send(room, "call spawn_subagent once with exactly this task, word for word: \"find the code word that was said earlier in this chat and answer with only the code word.\" then reply with only what the helper answered.")
      await until("the helper's code word", () => seen(room).live.length > after && statuses(room).at(-1) === "idle", 180_000)
      // The helper's own answer, the tool result, not the agent's reply: the agent knows the word itself.
      const trace = (await (await fetch(new URL("api/dev/agent/trace", v.url.endsWith("/") ? v.url : `${v.url}/`), { method: "POST", headers: { "content-type": "application/json", cookie: s.cookie }, body: JSON.stringify({ roomId }) })).json()) as { tool?: string; text?: string }[]
      const call = trace.map((e) => e.tool).lastIndexOf("spawn_subagent")
      const word = trace[call + 1]?.text ?? ""
      if (!/marigold-?42/i.test(word)) throw new VerifyError(`the helper did not know the chat's code word: ${JSON.stringify(word)}`)
      expectEqual((await children(v.url, s, roomId)).length, 2, "child conversations")
      step("a helper reads the chat's memory: it knew the code word")
    } finally {
      room.raw.close()
    }
  },
}

export default suite
