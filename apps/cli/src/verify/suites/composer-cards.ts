import type { HumanQuestion, RoomEvent } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import { frames, newRoom, poll } from "../kit"
import type { Suite } from "../runner"
import { fake, send } from "./mid-run"

const suite: Suite = {
  name: "composer-cards",
  async run(v) {
    const session = await v.as("composer-cards")
    const { roomId, room } = await newRoom(session, "Composer cards")
    await fake(v, session, roomId, ["kiko", "ada"])
    const events = (): RoomEvent[] => frames(room).flatMap((f) => f.t === "events" ? f.events : [])
    room.raw.send({ t: "task", op: { op: "create", id: "find", title: "Find cafés" } })
    await poll("the new task", () => events().some((e) => e.t === "task" && e.task.id === "find"), 5_000)
    room.raw.send({ t: "task", op: { op: "update", id: "find", status: "doing" } })
    await poll("the running task", () => events().some((e) => e.t === "task" && e.task.status === "doing"), 5_000)
    room.raw.send({ t: "task", op: { op: "update", id: "find", owner: "unknown" as never } })
    const refused = await room.expect((f) => f.t === "task_refused", 5_000)
    if (refused.t !== "task_refused" || !refused.reason.includes("member")) throw new VerifyError("task refusal did not explain the owner")
    console.log("  ok task progress is reactive, and an invalid owner is refused explicitly")

    await send(room, '[tool ask_human {"question":"Which places?","options":["Quiet cafés","Breakfast spots"]}]')
    const ask = await poll("the persisted question", () => events().find((e) => e.t === "ask"), 15_000)
    if (ask.t !== "ask") throw new VerifyError("no question")
    room.raw.send({ t: "hello", lastSeq: 1_000_000 })
    const reset = await room.expect((f) => f.t === "reset", 5_000)
    if (reset.t !== "reset") throw new VerifyError("no snapshot")
    expectEqual(reset.snapshot.asks?.map((a) => a.id), [ask.id], "open questions after reconnect")
    expectEqual(reset.snapshot.tasks[0]?.status, "doing", "task progress after reconnect")
    room.raw.send({ t: "answer", id: ask.id, value: "Quiet cafés" })
    await poll("the answer receipt", () => events().some((e) => e.t === "message" && e.clientId === `answer:${ask.id}` && e.text === "Quiet cafés" && e.replyTo === ask.messageId), 15_000)
    room.raw.send({ t: "answer", id: ask.id, value: "Breakfast spots" })
    room.raw.send({ t: "hello", lastSeq: 1_000_000 })
    const after = await room.expect((f) => f.t === "reset", 5_000)
    if (after.t !== "reset") throw new VerifyError("no answer snapshot")
    expectEqual(after.snapshot.asks, [], "resolved question removed")
    expectEqual(after.snapshot.messages.filter((m) => m.from.kind === "human" && m.replyTo === ask.messageId).map((m) => m.text), ["Quiet cafés"], "one answer despite a repeated submit")
    console.log("  ok questions and task progress survive reconnect; answering posts one reply and clears the question")
    const questions = [
      { id: "place", header: "Place", question: "Where should we meet?", options: [{ label: "Café", value: "cafe", description: "Somewhere quiet" }, { label: "Park", value: "park" }] },
      { id: "food", header: "Food", question: "What should they serve?", multiSelect: true, options: [{ label: "Tea" }, { label: "Cake" }] },
    ]
    await send(room, `[tool ask_human ${JSON.stringify({ questions })}]`)
    const batch = await poll("the batch question event", () => events().find((e) => e.t === "ask" && e.questions?.length === 2), 15_000)
    if (batch.t !== "ask") throw new VerifyError("no batched question")
    room.raw.send({ t: "hello", lastSeq: 1_000_000 })
    const batchReset = await room.expect((f) => f.t === "reset", 5_000)
    if (batchReset.t !== "reset") throw new VerifyError("no batch snapshot")
    const shape = (items: readonly HumanQuestion[] | undefined) => items?.map((q) => [q.id, q.header, q.question, !!q.multiSelect, q.options.map((o) => [o.label, o.value ?? o.label, o.description ?? ""])])
    expectEqual(shape(batchReset.snapshot.asks?.find((a) => a.id === batch.id)?.questions), shape(questions), "batch questions survive reconnect")
    room.raw.send({ t: "answer", id: batch.id, value: { place: "A quiet garden", food: ["Tea", "Cake"] } })
    await poll("one batch answer", () => events().some((e) => e.t === "message" && e.clientId === `answer:${batch.id}` && e.text === "Place: A quiet garden\nFood: Tea, Cake"), 15_000)
    console.log("  ok multi-question requests, described options, custom answers and multi-select replies survive reconnect")
    await send(room, '[textcall ask_human {"question":"Which city?","options":["Oslo","Rome"]}]')
    const typed = await poll("the question from a tool call written as text", () => events().find((e) => e.t === "ask" && e.text === "Which city?"), 15_000)
    if (typed.t !== "ask") throw new VerifyError("a tool call written as text did not run")
    const spoken = events().flatMap((e) => (e.t === "message" && e.from.kind === "agent" ? [e.text] : []))
    const leaked = spoken.filter((text) => /function_calls|invoke|parameter|atem:/.test(text))
    expectEqual(leaked, [], "agent bubbles that show tool-call markup")
    if (!spoken.includes("Sure, one moment.")) throw new VerifyError("the prose before the tool call was not posted as a bubble")
    console.log("  ok a tool call written as text runs its tool, and the bubble holds only the prose")
    room.raw.close()
  },
}

export default suite
