import { describe, expect, test } from "bun:test"
import { deleteFiles } from "../src/files/upload"

describe("deleteFiles", () => {
  test("deletes each file and its still, never more than 1,000 keys per call", async () => {
    const calls: string[][] = []
    const bucket = { delete: async (keys: string[]) => void calls.push(keys) } as unknown as R2Bucket
    const keys = Array.from({ length: 700 }, (_, i) => `u/r/${i}`)
    await deleteFiles(bucket, keys)
    expect(calls.map((c) => c.length)).toEqual([1000, 400])
    expect(calls.flat()).toContain("u/r/699/thumb")
  })

  test("one key deletes the file and its still", async () => {
    const calls: string[][] = []
    const bucket = { delete: async (keys: string[]) => void calls.push(keys) } as unknown as R2Bucket
    await deleteFiles(bucket, "u/r/a")
    expect(calls).toEqual([["u/r/a", "u/r/a/thumb"]])
  })
})
