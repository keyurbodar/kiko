import { expect, test } from "bun:test"
import { watchChanged } from "./changed"
import { userChannel } from "./socket"

test("a changed frame reloads that list once after a short wait, and other lists stay", async () => {
	let routines = 0
	let models = 0
	watchChanged("routines", () => void routines++)
	watchChanged("routines", () => void routines++)
	watchChanged("models", () => void models++)
	userChannel.deliver({ t: "changed", what: "routines" })
	userChannel.deliver({ t: "changed", what: "routines" })
	expect(routines).toBe(0)
	await Bun.sleep(450)
	expect([routines, models]).toEqual([1, 0])
	userChannel.opened()
	await Bun.sleep(450)
	expect([routines, models]).toEqual([2, 1])
})
