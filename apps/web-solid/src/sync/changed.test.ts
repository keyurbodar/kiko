import { expect, test } from "bun:test"
import { onChanged } from "./changed"
import { userChannel } from "./user-channel"

test("a changed frame reloads every reader of that list once after a short wait, and the unsubscribe stops it", async () => {
	let routines = 0
	let models = 0
	onChanged("memory", () => void routines++)
	const stop = onChanged("memory", () => void routines++)
	onChanged("models", () => void models++)
	userChannel.deliver({ t: "changed", what: "memory" })
	userChannel.deliver({ t: "changed", what: "memory" })
	expect(routines).toBe(0)
	await Bun.sleep(450)
	expect([routines, models]).toEqual([2, 0])
	stop()
	userChannel.opened()
	await Bun.sleep(450)
	expect([routines, models]).toEqual([3, 1])
})
