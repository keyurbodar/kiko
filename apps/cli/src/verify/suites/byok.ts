import type { RoomEvent, RoomToClient } from "@yuki/protocol"
import { connectTestModel, expectEqual, type RoomHandle, TEST_PROVIDER, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, seen, send, statuses, until } from "./mid-run"

// P4-02, architecture section 11.3. Every model request uses the user's own credential. A user
// with a connected provider gets an answer. A user with none gets a `no_provider` event and no
// run. Disconnecting mid-conversation makes the next message return `no_provider`.

const ANSWER_MS = 60_000
/** How long a refused message must stay without any sign of a run. Longer than the 1.5 s burst pause. */
const QUIET_MS = 5_000

function noProviders(room: RoomHandle): Extract<RoomEvent, { t: "no_provider" }>[] {
  return room.raw.log.flatMap((e) => {
    if (e.dir !== "in") return []
    const frame = e.frame as RoomToClient
    return frame.t === "events" ? frame.events.filter((ev) => ev.t === "no_provider") : []
  })
}

/** Status, typing, or draft frames after `from` in the log: any sign that a run started. */
function runSigns(room: RoomHandle, from: number): string[] {
  return room.raw.log.slice(from).flatMap((e) => {
    if (e.dir !== "in") return []
    const frame = e.frame as RoomToClient
    if (frame.t === "status" || frame.t === "draft") return [frame.t]
    if (frame.t === "typing" && frame.who.length) return ["typing"]
    return []
  })
}

async function refused(room: RoomHandle, before: number): Promise<void> {
  const from = room.raw.log.length
  await send(room, "reply with the single word ok.")
  await until("a no_provider event", () => noProviders(room).length > before, 15_000)
  const event = noProviders(room).at(-1)!
  expectEqual({ slug: event.slug, provider: event.provider }, { slug: "yuki", provider: TEST_PROVIDER }, "the no_provider event")
  const bubbles = seen(room).all.length
  await Bun.sleep(QUIET_MS)
  expectEqual(runSigns(room, from), [], "signs of a run after no_provider")
  expectEqual(seen(room).all.length, bubbles, "agent bubbles after no_provider")
  expectEqual(noProviders(room).length, before + 1, "no_provider events for one message")
}

const suite: Suite = {
  name: "byok",
  model: true,
  async run(v) {
    // A user with no provider: one event, no run.
    const none = await v.as(`byok-none-${crypto.randomUUID().slice(0, 8)}`)
    const empty = await newRoom(none, "byok without a provider")
    await refused(empty.room, 0)
    console.log("  a user with no provider got no_provider and no run")

    // A user with the test provider connected gets an answer.
    const alice = await v.as("byok-alice")
    await connectTestModel(alice)
    const { roomId, room } = await newRoom(alice, "byok check")
    await send(room, "reply with the single word ok.")
    await until("an answer", () => seen(room).live.length > 0, ANSWER_MS)
    await until("the run to end", () => statuses(room).at(-1) === "idle", ANSWER_MS)
    if (noProviders(room).length) throw new VerifyError("a connected user got no_provider")
    console.log(`  a connected user got ${JSON.stringify(seen(room).live.map((m) => m.text))}`)

    // Disconnect mid-conversation: the next message in the same room is refused.
    await alice.disconnectProvider(TEST_PROVIDER)
    await refused(room, 0)
    console.log("  after disconnecting, the next message got no_provider and no run")

    ;(await none.user()).send({ t: "chat", op: { op: "delete", roomId: empty.roomId as never } })
    ;(await alice.user()).send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
  },
}

export default suite
