import type { Message, RoomEvent, RoomToClient, SystemEvent } from "@kiko/protocol"
import { connectTestModel, expectEqual, type RoomHandle, VerifyError } from "../client"
import { frames, newRoom, poll, seen } from "../kit"
import type { Suite } from "../runner"
import { must } from "../must"
import { fake, send } from "./mid-run"

const FAKE_MS = 30_000
const MODEL_MS = 120_000

type Status = Extract<RoomToClient, { t: "status" }>

const statuses = (room: RoomHandle): Status[] => frames(room).filter((f): f is Status => f.t === "status")
const events = (room: RoomHandle): RoomEvent[] => frames(room).flatMap((f) => (f.t === "events" ? f.events : []))
const messages = (room: RoomHandle): Message[] => events(room).flatMap((e) => (e.t === "message" ? [e] : []))
const asks = (room: RoomHandle) => events(room).flatMap((e) => (e.t === "ask" ? [e] : []))
const resolved = (room: RoomHandle, id: string) => events(room).find((e) => e.t === "ask_resolved" && e.id === id)
const agentText = (room: RoomHandle) => seen(room).live.map((m) => m.text)
const subagent = (m: Message): Extract<SystemEvent, { kind: "subagent" }> | undefined => (m.event?.kind === "subagent" ? (m.event as Extract<SystemEvent, { kind: "subagent" }>) : undefined)

async function reconnected(s: { room(id: string): Promise<RoomHandle> }, roomId: string) {
  const other = await s.room(roomId)
  other.raw.sendRaw(JSON.stringify({ t: "hello", lastSeq: 1_000_000_000 }))
  const reset = await other.expect((f) => f.t === "reset", 5_000)
  other.raw.close()
  if (reset.t !== "reset") throw new VerifyError("no snapshot")
  return reset.snapshot
}

const suite: Suite = {
  name: "agent-activity",
  model: true,
  async run(v) {
    const s = await v.as("agent-activity")

    const { roomId, room } = await newRoom(s, "agent activity")
    await fake(v, s, roomId, ["kiko", "ada"])

    await send(room, "[tool] check")
    await poll("a typed tool status", () => statuses(room).some((f) => f.activity?.kind === "tool"), FAKE_MS)
    const tool = must(statuses(room).find((f) => f.activity?.kind === "tool"), "a tool status")
    expectEqual({ slug: tool.slug, tool: tool.activity?.kind === "tool" ? tool.activity.tool : null }, { slug: "kiko", tool: "other" }, "the tool status")
    if (!statuses(room).some((f) => f.activity?.kind === "writing")) throw new VerifyError("no status frame said the agent was writing")
    await poll("the agent to go idle", () => statuses(room).at(-1)?.state === "idle", FAKE_MS)
    expectEqual(statuses(room).at(-1), { t: "status", slug: "kiko", state: "idle" }, "the idle status carries no activity")
    console.log(`  ok a tool call is a typed status: ${JSON.stringify(tool.activity)}`)

    await send(room, "[tool] again, and show me while it runs")
    await poll("a busy agent", () => statuses(room).at(-1)?.state !== "idle", FAKE_MS)
    const busy = await reconnected(s, roomId)
    expectEqual(busy.agents?.map((a) => [a.slug, a.state !== "idle"]), [["kiko", true]], "the agents in a reconnect snapshot")
    await poll("the agent to go idle", () => statuses(room).at(-1)?.state === "idle", FAKE_MS)
    expectEqual((await reconnected(s, roomId)).agents, [], "the agents in a snapshot once everyone is idle")
    console.log("  ok a reconnect snapshot lists the busy agent, and nobody once it is idle")

    const before = statuses(room).length
    await send(room, "@kiko [ask ada] what port does the server use?")
    await poll("a waiting status", () => statuses(room).slice(before).some((f) => f.activity?.kind === "waiting"), FAKE_MS)
    const waiting = must(statuses(room).slice(before).find((f) => f.activity?.kind === "waiting"), "a waiting status")
    expectEqual({ slug: waiting.slug, activity: waiting.activity }, { slug: "kiko", activity: { kind: "waiting", on: "ada" } }, "the waiting status")
    await poll("the lead to go idle", () => statuses(room).slice(before).some((f) => f.slug === "kiko" && f.state === "idle"), FAKE_MS * 2)
    console.log(`  ok asking a teammate shows as waiting: ${JSON.stringify(waiting.activity)}`)

    await send(room, '[tool start_work {"task":"[steps 2] find flights"}]')
    const started = await poll("the worker's started line", () => messages(room).find((m) => subagent(m)?.state === "started"), FAKE_MS)
    expectEqual(started.event, { kind: "subagent", agent: "kiko", state: "started", title: "[steps 2] find flights", private: true }, "the started event")
    expectEqual(started.from, { kind: "system", reason: "work" }, "who the started line is from")
    const background = await poll("a background status", () => statuses(room).find((f) => f.activity?.kind === "background"), FAKE_MS)
    if (background.activity?.kind !== "background" || background.activity.workers[0]?.status !== "running") throw new VerifyError(`the background status is wrong: ${JSON.stringify(background)}`)
    const mid = await reconnected(s, roomId)
    expectEqual(mid.agents?.[0]?.activity?.kind, "background", "the snapshot while a worker runs")
    await poll("the worker's done line", () => messages(room).find((m) => subagent(m)?.state === "done"), FAKE_MS * 2)
    expectEqual(messages(room).filter((m) => subagent(m)).length, 2, "worker lines: one start and one end")
    await poll("the agent to go idle", () => statuses(room).at(-1)?.state === "idle", FAKE_MS)
    console.log(`  ok a worker is a background activity with its list, and one private line starts it and one ends it`)

    room.raw.send({ t: "search", query: "worker" })
    const found = await room.expect((f) => f.t === "search" && f.query === "worker", 5_000)
    if (found.t === "search" && found.results.some((r) => r.from.kind === "system")) throw new VerifyError("a private worker line showed up in search")
    console.log("  ok a private worker line is not in search")

    await send(room, '[tool ask_human {"question":"red or blue?","options":["red","blue"]}]')
    const ask = await poll("the ask event", () => asks(room).find((a) => a.text === "red or blue?"), FAKE_MS)
    expectEqual({ from: ask.from, options: ask.options }, { from: "kiko", options: ["red", "blue"] }, "the ask")
    expectEqual((await reconnected(s, roomId)).asks?.map((a) => a.id), [ask.id], "the open asks in a reconnect snapshot")
    room.raw.send({ t: "answer", id: ask.id, value: "blue" })
    await poll("the ask to close", () => resolved(room, ask.id), FAKE_MS)
    const closed = must(resolved(room, ask.id), "the ask_resolved event")
    expectEqual(closed.t === "ask_resolved" ? closed.how : null, "answered", "how the ask closed")
    const reply = must(messages(room).find((m) => m.from.kind === "human" && m.text === "blue"), "the human's answer")
    expectEqual(reply.replyTo, ask.messageId, "what the answer replies to")
    await poll("the agent to use the answer", () => agentText(room).some((t) => t.includes("the human answered: blue")), FAKE_MS)
    await Bun.sleep(3_000)
    expectEqual(agentText(room).filter((t) => t.includes("the human answered: blue")).length, 1, "agent replies that carry the answer")
    expectEqual((await reconnected(s, roomId)).asks, [], "the open asks once answered")
    console.log("  ok ask_human: a card, an answer as a reply, and the answer back in the same run")

    await send(room, '[tool ask_human {"question":"tea or coffee?"}]')
    const second = await poll("the second ask", () => asks(room).find((a) => a.text === "tea or coffee?"), FAKE_MS)
    room.raw.send({ t: "skip", id: second.id })
    await poll("the agent to hear the skip", () => agentText(room).some((t) => t.includes("the human skipped the question")), FAKE_MS)
    if (messages(room).some((m) => m.from.kind === "human" && m.replyTo === second.messageId)) throw new VerifyError("a skip was posted as a human message")
    console.log("  ok ask_human skip: the agent hears it and no human message is posted")

    const model = await v.as("agent-activity-model")
    await connectTestModel(model)
    const real = await newRoom(model, "agent activity, real model")
    await send(real.room, "Use the ask_human tool to ask me which fruit I like more. Offer the options apple and banana. After I answer, reply with one short sentence that names my choice.")
    const fruit = await poll("the model's question", () => asks(real.room)[0], MODEL_MS)
    if (!fruit.options?.length) throw new VerifyError(`the model asked without options: ${JSON.stringify(fruit)}`)
    real.room.raw.send({ t: "answer", id: fruit.id, value: "banana" })
    await poll("the model to name the choice", () => agentText(real.room).some((t) => /banana/i.test(t)), MODEL_MS)
    console.log(`  ok a real model asked ${JSON.stringify(fruit.text)} with ${JSON.stringify(fruit.options)} and replied ${JSON.stringify(agentText(real.room).at(-1))}`)

    const from = statuses(real.room).length
    await send(real.room, "Create a file named notes.md that contains the word hello, then tell me it is done in one sentence.")
    await poll("a typed tool status from the model", () => statuses(real.room).slice(from).some((f) => f.activity?.kind === "tool"), MODEL_MS)
    await poll("the model to go idle", () => statuses(real.room).at(-1)?.state === "idle", MODEL_MS)
    const kinds = [...new Set(statuses(real.room).slice(from).flatMap((f) => (f.activity?.kind === "tool" ? [`${f.activity.tool}: ${f.activity.caption}`] : [])))]
    console.log(`  ok the real model's tool calls were typed: ${JSON.stringify(kinds)}`)
  },
}

export default suite
