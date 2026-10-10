import type { AgentSlug, Message, RoomToClient } from "@yuki/protocol"
import { expectEqual, type Session, VerifyError } from "../client"
import type { Suite } from "../runner"
import { send, until } from "./mid-run"
import { agentSends, bubbles, messages, team } from "./team-loops"

// Architecture sections 7.5, 7.8, and 25.3, with the scripted fake agents (apps/server/src/agent/dev-fake.ts).
// No tokens. Needs a development server. Each part runs in its own room.
//
//   batch       three teammates write to a busy lead: the lead answers all three in one run
//   ask         a teammate answers an ask in a plain reply, and a human message to someone else meanwhile
//               does not cancel the ask
//   cross       two agents that ask each other: the second ask is refused, and both finish at once
//   refused     mail held behind a burst that the day's limit refused is still delivered
//   task wake   a task an agent made in work the human asked for wakes its owner with the human's authority

const slugOf = (m: Message) => (m.from.kind === "agent" ? m.from.slug : "")
const runsOf = (room: Parameters<typeof bubbles>[0], slug: string) => {
	const runs = new Map<string, string>()
	for (const m of bubbles(room)) if (slugOf(m) === slug) runs.set(m.run!.runId, `${runs.get(m.run!.runId) ?? ""}${m.text}\n`)
	return [...runs.values()]
}

async function batch(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben", "cy"], "one run for three replies")
	// ana works for five seconds. ben, cy, and yuki each write to her meanwhile.
	await send(room, "@ana [tool]")
	await send(room, "@ben [send ana] alpha")
	await send(room, "@cy [send ana] bravo")
	await send(room, "@yuki [send ana] charlie")
	await until("all three messages to ana", () => agentSends(room).length >= 3, 30_000)
	await until("ana's answer to the three", () => runsOf(room, "ana").some((t) => t.includes("charlie") || t.includes("alpha") || t.includes("bravo")), 30_000)
	await Bun.sleep(3_000)
	const answering = runsOf(room, "ana").filter((t) => /alpha|bravo|charlie/.test(t))
	expectEqual(answering.length, 1, "ana's runs that read her teammates' messages")
	for (const word of ["alpha", "bravo", "charlie"]) if (!answering[0]!.includes(word)) throw new VerifyError(`ana's one run missed ${word}: ${JSON.stringify(answering[0])}`)
	console.log(`  ok batch: ana read three teammate messages in one run (${runsOf(room, "ana").length} runs in all)`)
	room.raw.close()
}

async function ask(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben", "cy"], "plain answer")
	// ben writes a long answer for about six seconds, in a plain reply, not with send_message.
	await send(room, "@ana [ask ben] [slow] how big is it")
	await until("ben at work on the question", () => agentSends(room).some((m) => slugOf(m) === "ana"), 20_000)
	await Bun.sleep(1_500)
	// A human message for cy while ana waits on ben: ana's wait goes on.
	await send(room, "@cy [reply] hi cy")
	await until("cy's reply", () => bubbles(room).some((m) => slugOf(m) === "cy" && m.text === "hi cy"), 20_000)
	await until("ana's reply", () => bubbles(room).some((m) => slugOf(m) === "ana"), 30_000)
	const reply = runsOf(room, "ana")
	expectEqual(reply.length, 1, "ana's runs")
	if (!reply[0]!.includes("@ben answered: slow words")) throw new VerifyError(`ana's reply does not carry ben's plain answer: ${JSON.stringify(reply[0])}`)
	console.log(`  ok ask: ben's plain reply answered ana's ask, and the human's message to cy did not cancel it: ${JSON.stringify(reply[0]!.trim().slice(0, 120))}`)
	room.raw.close()
}

async function cross(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben"], "crossed asks")
	const started = Date.now()
	// ana asks ben, and ben's answer is to ask ana back.
	await send(room, "@ana [ask ben] [ask ana] which one?")
	await until("both replies", () => runsOf(room, "ana").length >= 1 && runsOf(room, "ben").length >= 1, 30_000)
	const took = Date.now() - started
	const [ana] = runsOf(room, "ana")
	const [ben] = runsOf(room, "ben")
	if (ana!.includes("answered: which one")) throw new VerifyError(`ben's question was taken as the answer to ana's: ${JSON.stringify(ana)}`)
	if (!ben!.includes("is waiting for your answer")) throw new VerifyError(`ben's ask back was not refused: ${JSON.stringify(ben)}`)
	if (!ana!.includes("@ben answered:")) throw new VerifyError(`ana got no answer: ${JSON.stringify(ana)}`)
	console.log(`  ok cross: ben's ask back was refused, his reply answered ana, both done in ${(took / 1000).toFixed(1)}s`)
	room.raw.close()
}

async function refused(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben"], "refused burst")
	const res = await fetch(new URL("api/dev/agent/limits", v.url.endsWith("/") ? v.url : `${v.url}/`), {
		method: "POST",
		headers: { "content-type": "application/json", cookie: s.cookie },
		body: JSON.stringify({ limits: { turnsPerDay: 1 } }),
	})
	if (!res.ok) throw new VerifyError(`the limits route answered ${res.status}`)
	// ana works three seconds, then writes to ben.
	await send(room, "@ana [later ben] hello ben.")
	const status = (slug: string, state: string) => () =>
		room.raw.log.some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as Extract<RoomToClient, { t: "status" }>).slug === slug && (e.frame as Extract<RoomToClient, { t: "status" }>).state === state)
	await until("ana at work", status("ana", "working"), 15_000)
	// A burst for ben opens while ana works, and stays open (the human keeps typing) until her mail is queued behind it.
	await send(room, "@ben [reply] no,")
	const sentAt = () => agentSends(room).some((m) => slugOf(m) === "ana")
	const end = Date.now() + 7_000
	while (!sentAt() && Date.now() < end) {
		room.raw.send({ t: "typing" })
		await Bun.sleep(700)
	}
	if (!sentAt()) throw new VerifyError("ana's message to ben never came while the burst was open")
	await until("the limit line", () => messages(room).some((m) => m.from.kind === "system" && /today's 1 replies/.test(m.text)), 15_000)
	// The day's turn is used: the burst starts no run. ana's mail, held behind it, still goes.
	await until("ben's answer to ana's mail", () => runsOf(room, "ben").some((t) => t.includes("hello ben")), 15_000)
	if (runsOf(room, "ben").some((t) => t.includes("no,"))) throw new VerifyError("the refused burst reached ben")
	console.log("  ok refused: mail held behind a refused burst reached ben")
	room.raw.close()
}

async function taskWake(v: { url: string }, s: Session) {
	const { room } = await team(v, s, ["ana", "ben"], "task authority")
	room.raw.send({ t: "task", op: { op: "create", id: "t1", title: "first", owner: "ana" as AgentSlug } })
	// yuki, the lead, makes t2 in a run the human started. t2 waits on t1 and asks its owner to act outside yuki.
	const t2 = JSON.stringify({ title: "[call fake_send] ship it", owner: "ben", depends_on: ["t1"] })
	await send(room, `@yuki [ws create_task ${t2}]`)
	await until("yuki's reply", () => runsOf(room, "yuki").length >= 1, 20_000)
	room.raw.send({ t: "task", op: { op: "update", id: "t1", status: "done" } })
	await until("ben's run on the wake", () => runsOf(room, "ben").length >= 1, 20_000)
	await Bun.sleep(1_500)
	const [ben] = runsOf(room, "ben")
	if (!ben!.includes("fake_send ran")) throw new VerifyError(`the task wake lost the human's authority: ${JSON.stringify(ben)}`)
	console.log(`  ok task wake: ben's wake ran with the human's authority: ${JSON.stringify(ben!.trim())}`)
	room.raw.close()
}

const suite: Suite = {
	name: "team-flow",
	async run(v) {
		const stamp = Date.now().toString(36)
		await batch(v, await v.as(`team-flow-batch-${stamp}`))
		await ask(v, await v.as(`team-flow-ask-${stamp}`))
		await cross(v, await v.as(`team-flow-cross-${stamp}`))
		await refused(v, await v.as(`team-flow-refused-${stamp}`))
		await taskWake(v, await v.as(`team-flow-task-${stamp}`))
	},
}

export default suite
