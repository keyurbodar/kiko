import { messages, poll } from "../kit"
import type { AgentSlug, Message } from "@kiko/protocol"
import { expectEqual, type Session, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send } from "./mid-run"
import { agentSends, bubbles, team } from "./team-loops"


const slugOf = (m: Message) => (m.from.kind === "agent" ? m.from.slug : "")
const runsOf = (room: Parameters<typeof bubbles>[0], slug: string) => {
	const runs = new Map<string, string>()
	for (const m of bubbles(room)) if (slugOf(m) === slug) runs.set(m.run?.runId ?? "", `${runs.get(m.run?.runId ?? "") ?? ""}${m.text}\n`)
	return [...runs.values()]
}

async function batch(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben", "cy"], "one run for three replies")
	await send(room, "@ana [tool]")
	await send(room, "@ben [send ana] alpha")
	await send(room, "@cy [send ana] bravo")
	await send(room, "@kiko [send ana] charlie")
	await poll("all three messages to ana", () => agentSends(room).length >= 3, 30_000)
	await poll("ana's answer to the three", () => runsOf(room, "ana").some((t) => t.includes("charlie") || t.includes("alpha") || t.includes("bravo")), 30_000)
	await Bun.sleep(3_000)
	const answering = runsOf(room, "ana").filter((t) => /alpha|bravo|charlie/.test(t))
	expectEqual(answering.length, 1, "ana's runs that read her teammates' messages")
	for (const word of ["alpha", "bravo", "charlie"]) if (!answering[0]?.includes(word)) throw new VerifyError(`ana's one run missed ${word}: ${JSON.stringify(answering[0])}`)
	console.log(`  ok batch: ana read three teammate messages in one run (${runsOf(room, "ana").length} runs in all)`)
	room.raw.close()
}

async function mail(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben", "cy"], "an answer as its own delivery")
	await send(room, "@ana [ask ben] [question] how big is it")
	await poll("ana's message to ben", () => agentSends(room).some((m) => slugOf(m) === "ana"), 20_000)
	await send(room, "@cy [reply] hi cy")
	await poll("cy's reply", () => bubbles(room).some((m) => slugOf(m) === "cy" && m.text === "hi cy"), 20_000)
	await poll("ana's reply carrying ben's answer", () => runsOf(room, "ana").some((t) => t.includes("[answer] 42")), 30_000)
	const reply = runsOf(room, "ana")
	expectEqual(reply.length, 2, "ana's runs: the message, then the answer")
	if (reply[0]?.includes("answered:")) throw new VerifyError(`ana's first run waited for ben: ${JSON.stringify(reply[0])}`)
	console.log(`  ok mail: ben's answer reached ana as its own delivery, and the human's message to cy did not cancel it: ${JSON.stringify(reply[1]?.trim().slice(0, 120))}`)
	room.raw.close()
}

async function taskWake(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben"], "task wake")
	room.raw.send({ t: "task", op: { op: "create", id: "t1", title: "first", owner: "ana" as AgentSlug } })
	const t2 = JSON.stringify({ title: "[call fake_send] ship it", owner: "ben", depends_on: ["t1"] })
	await send(room, `@kiko [ws create_task ${t2}]`)
	await poll("kiko's reply", () => runsOf(room, "kiko").length >= 1, 20_000)
	room.raw.send({ t: "task", op: { op: "update", id: "t1", status: "done" } })
	await poll("ben's run on the wake", () => runsOf(room, "ben").length >= 1, 20_000)
	await Bun.sleep(1_500)
	const [ben] = runsOf(room, "ben")
	if (!ben?.includes("fake_send ran")) throw new VerifyError(`ben's wake did not do the task: ${JSON.stringify(ben)}`)
	console.log(`  ok task wake: ben's wake did the task: ${JSON.stringify(ben?.trim())}`)
	room.raw.close()
}

const suite: Suite = {
	name: "team-flow",
	async run(v) {
		const stamp = Date.now().toString(36)
		await batch(v, await v.as(`team-flow-batch-${stamp}`))
		await mail(v, await v.as(`team-flow-mail-${stamp}`))
		await taskWake(v, await v.as(`team-flow-task-${stamp}`))
	},
}

export default suite
