import { expect, test } from "bun:test"
import { ANNOUNCE_WAKEUP, ANNOUNCE_WINDOW_MS, Announcements, COMPOSIO_CHANGE, KERNEL_CHANGE, providerChange } from "../src/user/announce"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

function setup() {
  const sql = sqlWith(USER_STEPS)
  const wakeups = new Map<string, number>()
  const sent: { id: string; body: string }[] = []
  const clock = { now: 1_000 }
  const fail = { send: false }
  const announce = new Announcements({
    sql,
    now: () => clock.now,
    alarms: {
      setWakeup: async (key, at) => void wakeups.set(key, at),
      clearWakeup: async (key) => void wakeups.delete(key),
      dueWakeups: async () => [],
    },
    send: async (id, body) => {
      if (fail.send) throw new Error("offline")
      sent.push({ id, body })
    },
  })
  return { announce, wakeups, sent, clock, fail }
}

const composio = (secret: string | null) => ({ ...COMPOSIO_CHANGE, secret })

test("adding a Composio key schedules one announcement that names the change", async () => {
  const { announce, wakeups, sent, clock } = setup()
  await announce.note(composio("ck_1"))
  expect(wakeups.get(ANNOUNCE_WAKEUP)).toBe(clock.now + ANNOUNCE_WINDOW_MS)
  await announce.flush()
  expect(sent).toHaveLength(1)
  expect(sent[0]?.id).toStartWith("system:")
  expect(sent[0]?.body).toContain("Added a Composio key")
  expect(sent[0]?.body).not.toContain("ck_1")
})

test("a setup change wakes the agent as information, and asks for no bubble about it", async () => {
  const { announce, sent } = setup()
  await announce.note(providerChange("anthropic", "sk-1"))
  await announce.flush()
  const body = sent[0]?.body ?? ""
  expect(body).toContain("Connected the model provider anthropic")
  expect(body).toContain("Reply only [skip]")
  expect(body).not.toMatch(/tell them/i)
})

test("saving the same key again announces nothing", async () => {
  const { announce, wakeups, sent } = setup()
  await announce.note(composio("ck_1"))
  await announce.flush()
  wakeups.clear()
  await announce.note(composio("ck_1"))
  expect(wakeups.size).toBe(0)
  await announce.flush()
  expect(sent).toHaveLength(1)
})

test("removing the key announces the removal, and removing nothing announces nothing", async () => {
  const { announce, wakeups, sent } = setup()
  await announce.note(composio(null))
  expect(wakeups.size).toBe(0)
  await announce.note(composio("ck_1"))
  await announce.flush()
  await announce.note(composio(null))
  await announce.flush()
  expect(sent).toHaveLength(2)
  expect(sent[1]?.body).toContain("Removed the Composio key")
})

test("changes inside one window make one wake, and an undone change drops out", async () => {
  const { announce, wakeups, sent } = setup()
  await announce.note(composio("ck_1"))
  await announce.note({ ...KERNEL_CHANGE, secret: "kk_1" })
  await announce.note(providerChange("anthropic", "sk-1"))
  await announce.note(providerChange("openai", "sk-2"))
  await announce.note(providerChange("openai", null))
  expect(wakeups.size).toBe(1)
  await announce.flush()
  expect(sent).toHaveLength(1)
  const body = sent[0]?.body ?? ""
  expect(body).toContain("Composio")
  expect(body).toContain("Kernel")
  expect(body).toContain("anthropic")
  expect(body).not.toContain("openai")
})

test("a failed send keeps the change and retries with the same id", async () => {
  const { announce, sent, fail } = setup()
  await announce.note(composio("ck_1"))
  fail.send = true
  await expect(announce.flush()).rejects.toThrow()
  fail.send = false
  await announce.flush()
  await announce.flush()
  expect(sent).toHaveLength(1)
})
