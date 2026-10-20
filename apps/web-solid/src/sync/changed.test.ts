import { expect, test } from "bun:test"
import { onChanged } from "./changed"
import { userChannel } from "./user-channel"

test("a changed frame reloads every reader of that list once after a short wait, and the unsubscribe stops it", async () => {
	let routines = 0
	let models = 0
	onChanged("routines", () => void routines++)
	const stop = onChanged("routines", () => void routines++)
	onChanged("models", () => void models++)
	userChannel.deliver({ t: "changed", what: "routines" })
	userChannel.deliver({ t: "changed", what: "routines" })
	expect(routines).toBe(0)
	await Bun.sleep(450)
	expect([routines, models]).toEqual([2, 0])
	stop()
	userChannel.opened()
	await Bun.sleep(450)
	expect([routines, models]).toEqual([3, 1])
})
