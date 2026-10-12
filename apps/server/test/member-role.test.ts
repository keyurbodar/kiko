import { expect, test } from "bun:test"
import type { AgentSlug } from "@yuki/protocol"
import { ROOM_STEPS } from "../src/room/schema"
import { Members } from "../src/room/members"
import { RoomLog } from "../src/room/log"
import { sqlWith } from "./sql-shim"

test("a stored role is cut to the 400 characters the brief shows, so the stored text is the text a member reads", () => {
  const sql = sqlWith(ROOM_STEPS)
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  const members = new Members(storage, new RoomLog(storage, () => 1))
  members.apply({ op: "add", slug: "ada" as AgentSlug, name: "Ada", role: "r".repeat(450) })
  expect(members.get("ada")?.role).toHaveLength(400)
})
