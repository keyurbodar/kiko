import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { migrate } from "@kiko/durable/migrate"
import { applyChatOp, leftoverTempRooms, listChats } from "../src/user/chats"
import { USER_STEPS } from "../src/user/schema"
import { LEGACY_USER_LAZY, LEGACY_USER_V1 } from "./legacy-schema"
import { sqlStorage } from "./sql-shim"

// A user object from before the temporary chat was removed. Its temporary chat carries the draft mark.
test("a temporary chat an older build left is found and removed, and the rest stay", () => {
  const db = new Database(":memory:")
  for (const s of [...LEGACY_USER_V1, ...LEGACY_USER_LAZY]) db.exec(s)
  migrate({ sql: sqlStorage(db), transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, USER_STEPS)
  db.exec("INSERT INTO chats (room_id, title, updated_at, draft) VALUES ('t1', 'new chat', 1, 'temp')")
  db.exec("INSERT INTO chats (room_id, title, updated_at, agents) VALUES ('a1', 'ada', 2, '[\"ada\"]')")
  const sql = sqlStorage(db)
  expect(leftoverTempRooms(sql)).toEqual(["t1"])
  applyChatOp(sql, { op: "delete", roomId: "t1" as never }, 3)
  expect(leftoverTempRooms(sql)).toEqual([])
  expect(listChats(sql).map((c) => c.roomId)).toEqual(["a1"])
})
