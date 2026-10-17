import { messages, newRoom, poll } from "../kit"
import { expectEqual } from "../client"
import type { Suite } from "../runner"
import { fake, send } from "./mid-run"

const errorRows = (room: Parameters<typeof messages>[0]) => messages(room).filter((m) => m.event?.kind === "run_error")

// One human message whose model call fails shows one error row. A spent quota is not retried; a busy
// provider is retried inside the run and still ends in one row. A retry that answers shows none.
const suite: Suite = {
	name: "run-error-once",
	async run(v) {
		const s = await v.as("run-error-once")
		for (const [label, error] of [
			["quota", '429: {"type":"GoUsageLimitError","message":"Go usage limit exceeded"}'],
			["busy", "503 overloaded"],
		] as const) {
			const { roomId, room } = await newRoom(s, `run error ${label}`)
			await fake(v, s, roomId)
			await send(room, `[model-error] ${error}`)
			await poll(`the ${label} error row`, () => errorRows(room).length > 0, 40_000)
			await Bun.sleep(20_000)
			expectEqual(errorRows(room).length, 1, `${label}: error rows for one failed message`)
			room.raw.close()
		}
		const { roomId, room } = await newRoom(s, "run error recovers")
		await fake(v, s, roomId)
		await send(room, `[model-error-once] 503 overloaded ${Date.now()}`)
		await poll("the answer after the retry", () => messages(room).some((m) => m.from.kind === "agent" && m.text === "recovered"), 40_000)
		await Bun.sleep(2_000)
		expectEqual(errorRows(room).length, 0, "error rows for a run whose retry answered")
		room.raw.close()
	},
}

export default suite
