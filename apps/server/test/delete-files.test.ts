import { describe, expect, test } from "bun:test"
import { deleteFiles } from "../src/files/upload"

describe("deleteFiles", () => {
  test("deletes each file, never more than 1,000 keys per call", async () => {
    const calls: string[][] = []
    const bucket = { delete: async (keys: string[]) => void calls.push(keys) } as unknown as R2Bucket
    const keys = Array.from({ length: 2500 }, (_, i) => `u/r/${i}`)
    await deleteFiles(bucket, keys)
    expect(calls.map((c) => c.length)).toEqual([1000, 1000, 500])
    expect(calls.flat()).toEqual(keys)
  })

  test("one key deletes that file and nothing else", async () => {
    const calls: string[][] = []
    const bucket = { delete: async (keys: string[]) => void calls.push(keys) } as unknown as R2Bucket
    await deleteFiles(bucket, "u/r/a")
    expect(calls).toEqual([["u/r/a"]])
  })
})
