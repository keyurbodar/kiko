import { expect, test } from "bun:test"
import { Life } from "@kiko/memory/life"
import { MemoryCapture } from "../src/user/memory-capture"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const SECRET = "The human's private booking code is saffron-729."
const now = Date.UTC(2026, 9, 19)

function setup() {
  const sql = sqlWith(USER_STEPS)
  const settings = new Map<string, string>()
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  for (let i = 0; i < 32; i++) {
    expect(life.append(i === 0 ? SECRET : `Memory ${i}: the human prefers a quiet room when reading a book.`, "human", now + i, { ref: `message:${i}` }).ok).toBe(true)
  }
  const mem = new MemoryCapture({
    sql,
    life,
    alarms: { setWakeup: async () => {}, clearWakeup: async () => {}, dueWakeups: async () => [] },
    label: "test",
    credentials: () => { throw new Error("No credentials needed for summary tests") },
    turn: async () => { throw new Error("No model needed for summary tests") },
  })
  return { life, mem }
}

test("redaction removes higher summaries even when all lower levels are missing", () => {
  const { life } = setup()
  life.tree.put({ lo: 0, hi: 16 }, { text: SECRET, from: now, to: now + 15 })
  life.tree.put({ lo: 16, hi: 32 }, { text: "The human likes quiet rooms.", from: now + 16, to: now + 31 })
  life.tree.put({ lo: 0, hi: 32 }, { text: SECRET, from: now, to: now + 31 })
  expect(life.zoom({ lo: 0, hi: 32 }, now).join("\n")).toContain("saffron-729")

  expect(life.redact(0)).toBe(true)

  expect(life.tree.node({ lo: 0, hi: 16 })).toBeNull()
  expect(life.tree.node({ lo: 0, hi: 32 })).toBeNull()
  expect(life.tree.node({ lo: 16, hi: 32 })?.text).toBe("The human likes quiet rooms.")
  expect(life.tree.render({ lo: 0, hi: 32 }, now).join("\n")).not.toContain("saffron-729")
  expect(life.zoom({ lo: 0, hi: 32 }, now).join("\n")).not.toContain("saffron-729")
  expect(life.recall("saffron")).toEqual([])
})

for (const change of ["redact", "redactRefs", "supersede"] as const) {
  test(`a summary awaiting compression cannot revive a memory after ${change}`, async () => {
    const { life, mem } = setup()
    let changed = false
    mem.compress = async (prompt) => {
      await Promise.resolve()
      if (prompt.includes("saffron-729")) {
        changed = true
        if (change === "redact") expect(life.redact(0)).toBe(true)
        else if (change === "redactRefs") expect(life.redactRefs(["message:0"])).toEqual([0])
        else expect(life.supersede(0, 31)).toBe(true)
        return { text: SECRET }
      }
      return { text: "The human likes quiet rooms." }
    }

    await mem.napLife()

    expect(changed).toBe(true)
    expect(life.view(now)).not.toContain("saffron-729")
    expect(life.zoom({ lo: 0, hi: 32 }, now).join("\n")).not.toContain("saffron-729")
    expect(life.recall("saffron")).toEqual([])

    await mem.napLife()
    expect(life.tree.node({ lo: 0, hi: 8 })?.text).toBe("The human likes quiet rooms.")
    expect(life.view(now)).not.toContain("saffron-729")
  })
}
