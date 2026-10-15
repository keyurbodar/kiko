import type { RoomEvent } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import { frames, newRoom, poll } from "../kit"
import type { Suite } from "../runner"
import { fake, send } from "./mid-run"

const suite: Suite = {
  name: "composer-cards",
  async run(v) {
    const session = await v.as("composer-cards")
    const { roomId, room } = await newRoom(session, "Composer cards")
    await fake(v, session, roomId, ["yuki", "ada"])
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
    room.raw.close()
  },
}

export default suite
