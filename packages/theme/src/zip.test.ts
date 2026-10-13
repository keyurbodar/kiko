import { describe, expect, test } from "bun:test"
import { zipOf } from "../test/zip-writer"
import { readZipEntries } from "./zip"

const MB = 1024 * 1024
const all = () => true

describe("readZipEntries", () => {
  test("inflates deflated and stored entries it is asked for, and skips the rest", async () => {
    const bytes = await zipOf([
      { name: "extension/package.json", data: '{"name":"x"}', deflate: true },
      { name: "extension/readme.md", data: "not read" },
      { name: "extension/themes/a.json", data: '{"colors":{}}' },
    ])
    const entries = await readZipEntries(bytes, (name) => name.endsWith(".json"), MB)
    expect(new TextDecoder().decode(entries.get("extension/package.json"))).toBe('{"name":"x"}')
    expect(new TextDecoder().decode(entries.get("extension/themes/a.json"))).toBe('{"colors":{}}')
    expect(entries.has("extension/readme.md")).toBe(false)
  })

  test("refuses a file name that leaves the package", async () => {
    const bytes = await zipOf([{ name: "extension/../../evil.json", data: "{}" }])
    await expect(readZipEntries(bytes, all, MB)).rejects.toThrow("unsafe file name")
  })

  test("refuses a file that inflates past the ratio limit", async () => {
    const bytes = await zipOf([{ name: "extension/bomb.json", data: new Uint8Array(4 * MB), deflate: true }])
    await expect(readZipEntries(bytes, all, 8 * MB)).rejects.toThrow("compression ratio")
  })

  test("refuses a file larger than the caller's limit", async () => {
    const bytes = await zipOf([{ name: "extension/big.json", data: "x".repeat(2000) }])
    await expect(readZipEntries(bytes, all, 1000)).rejects.toThrow("too large")
  })

  test("refuses bytes with no directory", async () => {
    await expect(readZipEntries(new Uint8Array(100), all, MB)).rejects.toThrow("no ZIP directory")
  })
})
