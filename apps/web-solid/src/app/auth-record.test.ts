import { describe, expect, it } from "vitest"
import { formatRecord, parseRecord, readyOf, recordOf, type AuthRecord } from "./auth-record"
import type { BackendKey, BackendUrl, ClerkUserId, SessionToken } from "./phase"

const record: AuthRecord = {
  v: 1,
  identity: { clerkUserId: "user_a" as ClerkUserId, email: "a@example.com" },
  backend: { url: "https://kiko.a.workers.dev" as BackendUrl, key: "0123456789abcdef" as BackendKey },
  user: { id: "owner", name: "owner" },
  token: "owner.session.1.mac" as SessionToken,
}

describe("the kiko:auth record", () => {
  it("round-trips through its stored text", () => {
    expect(parseRecord(formatRecord(record))).toEqual(record)
  })

  it.each([
    ["missing", null],
    ["not JSON", "{"],
    ["an older shape", JSON.stringify({ token: "owner.session.1.mac" })],
    ["a future version", JSON.stringify({ ...record, v: 2 })],
  ])("reads as signed out when the stored text is %s", (_, raw) => {
    expect(parseRecord(raw)).toBeNull()
  })

  it("is the Ready phase without its update state", () => {
    const ready = readyOf(record)
    expect(ready).toEqual({
      _tag: "Ready",
      identity: record.identity,
      backend: record.backend,
      user: record.user,
      token: record.token,
      update: { _tag: "Current" },
    })
    expect(recordOf(ready)).toEqual(record)
  })
})
