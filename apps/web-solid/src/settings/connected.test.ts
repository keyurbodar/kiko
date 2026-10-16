import { beforeEach, expect, test } from "bun:test"
import { readStored, writeStored } from "./connected-store"

const data = new Map<string, string>()
beforeEach(() => {
  data.clear()
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  })
})

const anthropic = { provider: "anthropic", kind: "api_key", last4: "abcd" }

test("the last connected list comes back for the same user, so a reload does not flash empty", () => {
  writeStored("u1", [anthropic])
  expect(readStored("u1")).toEqual([anthropic])
})

test("another user and a damaged value read as empty", () => {
  writeStored("u1", [anthropic])
  expect(readStored("u2")).toEqual([])
  data.set("kiko:providers:u1", "{not json")
  expect(readStored("u1")).toEqual([])
})
