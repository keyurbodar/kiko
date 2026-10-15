import { poll } from "../kit"
import { newRoomId } from "@kiko/protocol"
import type { Agent, AgentSlug, Message, RoomEvent, RoomId, RoomToClient, Task } from "@kiko/protocol"
import type { RoomHandle } from "../client"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send } from "./mid-run"
import { must } from "../must"


const TEAM = ["bob", "ada", "cy"] as const
const agentOf = (name: string): Agent => ({ id: `workspace-${name}`, name, slug: name as AgentSlug, prompt: "", model: "opencode-go/deepseek-v4.1-flash" })

async function dev(url: string, cookie: string, path: string, body: unknown): Promise<unknown> {
	const res = await fetch(new URL(`api/dev/agent/${path}`, url), {
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
		const roomId = newRoomId() as RoomId
		user.send({ t: "chat", op: { op: "create", roomId, title: "ship it", agents: TEAM.map((n) => agentOf(n).id) } })
		await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
		const room = await s.room(roomId)
		await dev(v.url, s.cookie, "fake", { roomId, slugs: ["yuki", ...TEAM] })
		await poll("three members", () => events(room).filter((e) => e.t === "member").length >= 3, 5_000)
		const status = async (slug: string) => (await dev(v.url, s.cookie, "status", { roomId, slug })) as Status
		const received = async (slug: string) => {
			const st = await status(slug)
			return st.inbox.waiting + st.inbox.claimed + st.inbox.submitted
		}

		room.raw.send({ t: "task", op: { op: "create", id: "task-a", title: "draft the plan", owner: "ada" as AgentSlug } })
		await poll("task a", () => tasks(room).has("task-a"), 5_000)
		await send(room, `@yuki [ws create_task {"title":"review the plan","owner":"cy","depends_on":["task-a"]}]`)
		await poll("task b", () => tasks(room).size === 2, 15_000)
		const b = must([...tasks(room).values()].find((t) => t.id !== "task-a"), "task-a's sibling")
		expectEqual({ owner: b.owner, status: b.status, dependsOn: b.dependsOn }, { owner: "cy", status: "todo", dependsOn: ["task-a"] }, "task b")
		await poll("kiko's answer", () => bubbles(room, "yuki").length === 1, 15_000)
		console.log(`  ok board: task-a for ada, ${b.id} for cy after task-a (kiko: ${JSON.stringify(bubbles(room, "yuki")[0])})`)

		await send(room, `@cy [ws update_task {"id":"task-a","status":"doing"}]`)
		await poll("cy's answer", () => bubbles(room, "cy").length === 1, 15_000)
		const refusal = must(bubbles(room, "cy")[0], "refusal")
		if (!refusal.includes("owned by @ada")) throw new VerifyError(`cy's answer does not name the owner: ${refusal}`)
		expectEqual(tasks(room).get("task-a")?.owner, "ada", "task a's owner after cy tried to take it")
		console.log(`  ok taking refused: ${JSON.stringify(refusal)}`)

		await Bun.sleep(2_000)
		const before = await received("cy")
		expectEqual(before, 1, "envelopes cy received before task a is done (only the @cy message)")
		console.log(`  ok not woken: cy holds ${before} envelope while task-a is open`)

		await send(room, `@ada [ws update_task {"id":"task-a","status":"done"}]`)
		await poll("task a done", () => tasks(room).get("task-a")?.status === "done", 15_000)
		await poll("cy's second answer", () => bubbles(room, "cy").length === 2, 15_000)
		expectEqual(await received("cy"), before + 1, "envelopes cy received after task a is done")
		const woke = must(bubbles(room, "cy")[1], "woke")
		if (!woke.includes(`task ${b.id}`) || !woke.includes("unblocked")) throw new VerifyError(`cy's wake answer: ${woke}`)
		console.log(`  ok unblocked: cy received 1 task_unblocked envelope and answered ${JSON.stringify(woke)}`)

		room.raw.send({ t: "task", op: { op: "update", id: "task-a", status: "review" } })
		room.raw.send({ t: "task", op: { op: "update", id: "task-a", status: "done" } })
		await poll("task a done again", () => events(room).filter((e) => e.t === "task" && e.task.id === "task-a" && e.task.status === "done").length === 2, 5_000)
		await Bun.sleep(3_000)
		expectEqual(await received("cy"), before + 1, "envelopes cy received after task a was finished twice")
		console.log(`  ok once: finishing task-a again delivered nothing more`)

		room.raw.send({ t: "hello", lastSeq: 1_000_000 })
		const reset = await room.expect((f) => f.t === "reset", 5_000)
		if (reset.t !== "reset") throw new VerifyError("no reset")
		expectEqual(reset.snapshot.tasks.map((t) => `${t.id}:${t.status}`), ["task-a:done", `${b.id}:todo`], "tasks in the snapshot")
		console.log(`  ok snapshot: ${reset.snapshot.tasks.length} tasks`)
		const beforeAda = await received("ada")
		await send(room, '@yuki [ws create_task {"title":"Check newsletter senders","owner":"ada"}]')
		const assigned = await poll("the assigned task", () => [...tasks(room).values()].find((t) => t.title === "Check newsletter senders"), 15_000)
		await poll("automatic assignment delivery", async () => await received("ada") === beforeAda + 1, 15_000)
		const beforeLead = await received("yuki")
		await send(room, `@ada [ws update_task ${JSON.stringify({ id: assigned.id, status: "review", note: "Saved newsletter findings in /senders.md" })}]`)
		await poll("automatic lead report", async () => await received("yuki") === beforeLead + 1, 15_000)
		await poll("the lead to react", () => bubbles(room, "yuki").some((text) => text.includes("/senders.md")), 15_000)
		console.log("  ok ready assignments wake their owner, and review results reach the lead without a separate message")
		room.raw.close()
	},
}

export default suite
