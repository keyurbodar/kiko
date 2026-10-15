import { expect, test } from "bun:test"
import { SyncMemo } from "../src/agent/extension-sync"

const v1 = [{ name: "a", hash: "h1" }]

test("the same list on the same instance syncs once, even when the sync found a broken extension", async () => {
  const memo = new SyncMemo()
  const on = {}
  let runs = 0
  const sync = async () => {
    runs++
    return [{ name: "a", hash: "h1", error: "failed to load" }]
  }
  await memo.apply(on, v1, sync)
  await memo.apply(on, v1, sync)
  expect(runs).toBe(1)
})

test("a new list or a new instance syncs again, and a sync that throws is retried", async () => {
  const memo = new SyncMemo()
  const on = {}
  let runs = 0
  const sync = async () => void runs++
  await memo.apply(on, v1, sync)
  await memo.apply(on, [{ name: "a", hash: "h2" }], sync)
  await memo.apply({}, [{ name: "a", hash: "h2" }], sync)
  expect(runs).toBe(3)
  const boom = new SyncMemo()
  await expect(boom.apply(on, v1, async () => Promise.reject(new Error("down")))).rejects.toThrow("down")
  await boom.apply(on, v1, sync)
  expect(runs).toBe(4)
})

test("stored bundles are scanned once per list", () => {
  const memo = new SyncMemo()
  expect([memo.firstSight("a"), memo.firstSight("a"), memo.firstSight("b")]).toEqual([true, false, true])
})
