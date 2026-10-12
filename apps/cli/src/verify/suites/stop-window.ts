import type { RoomToClient } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, seen, send, statuses, until } from "./mid-run"

// Stop inside the one-second window after a human message keeps the message. The agent answers it
// once, after the stop, and the room posts no notice.
const suite: Suite = {
	name: "stop-window",
	async run(v) {
		const s = await v.as("stop-window")
		const { roomId, room } = await newRoom(s, "stop window")
		await fake(v, s, roomId)
		await send(room, "window message")
		if (statuses(room).includes("typing")) throw new VerifyError("the agent started before the stop, so the stop missed the window")
		room.raw.send({ t: "stop" })
		await until("the answer", () => seen(room).live.some((m) => m.text.startsWith("heard:")), 15_000)
		await Bun.sleep(2_000)
		expectEqual(seen(room).live.map((m) => m.text), ["heard: window message"], "the agent's bubbles: the message went out once")
		const notices = room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? (e.frame as Extract<RoomToClient, { t: "events" }>).events : [])).filter((e) => e.t === "message" && e.from.kind === "system" && /could not reach|answered at/.test(e.text))
		expectEqual(notices.length, 0, "notices about the message")
		room.raw.close()
	},
}

export default suite
