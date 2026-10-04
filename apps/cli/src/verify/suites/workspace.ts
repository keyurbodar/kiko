import type { Agent, AgentSlug, Message, RoomEvent, RoomId, RoomToClient, Task } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send, ulid, until } from "./mid-run"

// P6-02, architecture section 7.6. The task board with fake agents (`apps/server/src/agent/dev-fake.ts`),
// so the suite is deterministic and spends no tokens. kiko leads the group (section 7.11); bob, ada and cy are members. The
// fake calls a workspace tool for `[ws <tool> <json>]` and answers `heard: ...; tool: <result>`.
// Needs a development server.
//
//   the human creates task A for ada, and the lead's create_task adds B for cy after A
//   cy taking A fails and names the owner
//   cy is not woken while A is open
//   ada marks A done with update_task, and cy gets exactly one task_unblocked envelope
//   finishing A again wakes nobody

const TEAM = ["bob", "ada", "cy"] as const
const agentOf = (name: string): Agent => ({ id: `workspace-${name}`, name, slug: name as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })
const base = (url: string) => (url.endsWith("/") ? url : `${url}/`)

async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
	const res = await fetch(new URL(`api/dev/agent/${path}`, base(url)), {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	})
	if (!res.ok) throw new VerifyError(`the dev agent route answered ${res.status}. start the Worker with NODE_ENV=development`)
	return res.json()
}

type Status = { inbox: { waiting: number; claimed: number; submitted: number }; submissions: number }

const events = (room: RoomHandle): RoomEvent[] =>
	room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? [...(e.frame as Extract<RoomToClient, { t: "events" }>).events] : []))
const tasks = (room: RoomHandle): Map<string, Task> => {
	const out = new Map<string, Task>()
	for (const e of events(room)) if (e.t === "task") out.set(e.task.id, e.task)
	return out
}
const bubbles = (room: RoomHandle, slug: string): string[] =>
	events(room).flatMap((e) => (e.t === "message" && e.from.kind === "agent" && e.from.slug === slug ? [(e as Message).text] : []))

const suite: Suite = {
	name: "workspace",
	async run(v) {
		const s = await v.as("workspace")
		const user = await s.user()
		for (const name of TEAM) user.send({ t: "agent", op: { op: "create", agent: agentOf(name) } })
		const roomId = ulid() as RoomId
		user.send({ t: "chat", op: { op: "create", roomId, title: "ship it", agents: TEAM.map((n) => agentOf(n).id) } })
		await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
		const room = await s.room(roomId)
		// A group is seeded with kiko first, as its lead, so kiko is a fake too.
		await dev(v.url, s.cookie, "fake", { roomId, slugs: ["kiko", ...TEAM] })
		await until("three members", () => events(room).filter((e) => e.t === "member").length >= 3, 5_000)
		const status = async (slug: string) => (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
		const received = async (slug: string) => {
			const st = await status(slug)
			return st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
		}

		// 1. The human creates A for ada; the lead's tool adds B for cy, after A.
		room.raw.send({ t: "task", op: { op: "create", id: "task-a", title: "draft the plan", owner: "ada" as AgentSlug } })
		await until("task a", () => tasks(room).has("task-a"), 5_000)
		await send(room, `@kiko [ws create_task {"title":"review the plan","owner":"cy","depends_on":["task-a"]}]`)
		await until("task b", () => tasks(room).size === 2, 15_000)
		const b = [...tasks(room).values()].find((t) => t.id !== "task-a")!
		expectEqual({ owner: b.owner, status: b.status, dependsOn: b.dependsOn }, { owner: "cy", status: "todo", dependsOn: ["task-a"] }, "task b")
		await until("kiko's answer", () => bubbles(room, "kiko").length === 1, 15_000)
		console.log(`  ok board: task-a for ada, ${b.id} for cy after task-a (kiko: ${JSON.stringify(bubbles(room, "kiko")[0])})`)

		// 2. cy taking A fails and names the owner.
		await send(room, `@cy [ws update_task {"id":"task-a","status":"doing"}]`)
		await until("cy's answer", () => bubbles(room, "cy").length === 1, 15_000)
		const refusal = bubbles(room, "cy")[0]!
		if (!refusal.includes("owned by @ada")) throw new VerifyError(`cy's answer does not name the owner: ${refusal}`)
		expectEqual(tasks(room).get("task-a")?.owner, "ada", "task a's owner after cy tried to take it")
		console.log(`  ok taking refused: ${JSON.stringify(refusal)}`)

		// 3. cy is not woken while A is open.
		await Bun.sleep(2_000)
		const before = await received("cy")
		expectEqual(before, 1, "envelopes cy received before task a is done (only the @cy message)")
		console.log(`  ok not woken: cy holds ${before} envelope while task-a is open`)

		// 4. ada finishes A with her tool. cy gets one task_unblocked envelope.
		await send(room, `@ada [ws update_task {"id":"task-a","status":"done"}]`)
		await until("task a done", () => tasks(room).get("task-a")?.status === "done", 15_000)
		await until("cy's second answer", () => bubbles(room, "cy").length === 2, 15_000)
		expectEqual(await received("cy"), before + 1, "envelopes cy received after task a is done")
		const woke = bubbles(room, "cy")[1]!
		if (!woke.includes(`task ${b.id}`) || !woke.includes("unblocked")) throw new VerifyError(`cy's wake answer: ${woke}`)
		console.log(`  ok unblocked: cy received 1 task_unblocked envelope and answered ${JSON.stringify(woke)}`)

		// 5. Reopening and finishing A again wakes nobody a second time.
		room.raw.send({ t: "task", op: { op: "update", id: "task-a", status: "review" } })
		room.raw.send({ t: "task", op: { op: "update", id: "task-a", status: "done" } })
		await until("task a done again", () => events(room).filter((e) => e.t === "task" && e.task.id === "task-a" && e.task.status === "done").length === 2, 5_000)
		await Bun.sleep(3_000)
		expectEqual(await received("cy"), before + 1, "envelopes cy received after task a was finished twice")
		console.log(`  ok once: finishing task-a again delivered nothing more`)

		// 6. A reset snapshot carries the board.
		room.raw.send({ t: "hello", lastSeq: 1_000_000 })
		const reset = await room.expect((f) => f.t === "reset", 5_000)
		if (reset.t !== "reset") throw new VerifyError("no reset")
		expectEqual(reset.snapshot.tasks.map((t) => `${t.id}:${t.status}`), ["task-a:done", `${b.id}:todo`], "tasks in the snapshot")
		console.log(`  ok snapshot: ${reset.snapshot.tasks.length} tasks`)
		room.raw.close()
	},
}

export default suite
