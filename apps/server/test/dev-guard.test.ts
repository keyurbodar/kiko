import { expect, test } from "bun:test"

// `bun test` runs without NODE_ENV=development, so this is the production side of the fold: the guarded
// loads throw "not found" and the dev modules are never imported. The dev side is covered by a yuki
// verify suite on a dev server.
test("a dev-only load refuses outside a development build", async () => {
  const guard = await import("../src/lib/dev-guard")
  expect(guard.DEV).toBe(false)
  expect(() => guard.loadRoomDev()).toThrow("not found")
  expect(() => guard.loadUserDev()).toThrow("not found")
  expect(() => guard.loadAgentDev()).toThrow("not found")
})

test("a dev-only object method refuses outside a development build", async () => {
  const { RoomDev } = await import("../src/room/dev")
  const dev = new RoomDev({} as never)
  await expect(dev.memory()).rejects.toThrow("not found")
  await expect(dev.seed([])).rejects.toThrow("not found")
  await expect(dev.quiet()).rejects.toThrow("not found")
})
