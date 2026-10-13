import { expect, test } from "bun:test"

// `bun test` runs without NODE_ENV=development, so this is the production side of the fold: the guarded
// loads throw "not found" and the dev modules are never imported. The dev side is covered by a kiko
// verify suite on a dev server. Each DO holds one cached load, so this guards every dev method of all three.
test("a dev-only load refuses outside a development build", async () => {
  const guard = await import("../src/lib/dev-guard")
  expect(guard.DEV).toBe(false)
  expect(() => guard.loadRoomDev()).toThrow("not found")
  expect(() => guard.loadUserDev()).toThrow("not found")
  expect(() => guard.loadAgentDev()).toThrow("not found")
})
