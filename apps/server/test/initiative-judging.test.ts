import { expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import { InitiativeLoops, type LoopsDeps } from "../src/user/initiative-loops"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

function judgingWith(capture: "auto" | "always" | "off") {
  const sql = sqlWith(USER_STEPS)
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const memory = {
    judgeKey: () => ({ key: {}, model: null }),
    policy: () => ({ capture }),
    capturable: () => true,
  }
  const loops = new InitiativeLoops({ sql, memory, transaction: (fn: () => unknown) => fn() } as unknown as LoopsDeps)
  return loops.judging("r1" as RoomId)
}

test("a judge key with capture off leaves Jev out of a chat, so the two-word touch decides engagement", () => {
  expect(judgingWith("off")).toBe(false)
  expect(judgingWith("auto")).toBe(true)
})
