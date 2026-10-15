import { expect, test } from "bun:test"
import { ownScriptName } from "./plan"

test("fallback script name is stable per user", async () => {
  expect(await ownScriptName("user_1")).toBe(await ownScriptName("user_1"))
  expect(await ownScriptName("user_1")).toMatch(/^kiko-[0-9a-f]{6}$/)
  expect(await ownScriptName("user_1")).not.toBe(await ownScriptName("user_2"))
})
