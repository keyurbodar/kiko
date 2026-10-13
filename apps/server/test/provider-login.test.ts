import { expect, test } from "bun:test"
import { InMemoryCredentialStore } from "@earendil-works/pi-ai"
import type { UserToClient } from "@kiko/protocol"
import { FAKE_CODE, FAKE_PROVIDER, fakeProvider } from "../src/user/dev"
import { ProviderLogins } from "../src/user/provider-login"

function setup(options: { fake?: boolean } = {}) {
  const store = new InMemoryCredentialStore()
  const frames: { owner: string; frame: UserToClient }[] = []
  const logins = new ProviderLogins<string>({
    store,
    info: (provider) => (provider === FAKE_PROVIDER ? { provider, kind: "oauth", last4: "" } : null),
    send: (owner, frame) => void frames.push({ owner, frame }),
    ...((options.fake ?? true) ? { devProvider: async (id: string) => fakeProvider(id) } : {}),
  })
  const seen = (owner = "ws1") => frames.filter((f) => f.owner === owner).map((f) => f.frame)
  async function next(t: UserToClient["t"], owner = "ws1"): Promise<any> {
    for (let i = 0; i < 100; i++) {
      const found = seen(owner).find((f) => f.t === t)
      if (found) return found
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`no ${t} frame. got ${JSON.stringify(seen(owner))}`)
  }
  return { store, frames, logins, seen, next }
}

test("the fake flow notifies, prompts, and stores the credential", async () => {
  const s = setup()
  const run = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  const notify = await s.next("login.notify")
  expect(notify.event).toMatchObject({ type: "device_code", userCode: FAKE_CODE })
  const prompt = await s.next("login.prompt")
  expect(prompt.prompt).toEqual({ type: "manual_code", message: "type the code shown above" })
  s.logins.answer("ws1", "l1", prompt.promptId, FAKE_CODE)
  await run
  expect(await s.next("login.done")).toEqual({
    t: "login.done",
    loginId: "l1",
    provider: { provider: FAKE_PROVIDER, kind: "oauth", last4: "" },
  })
  expect((await s.store.read(FAKE_PROVIDER))?.type).toBe("oauth")
  expect(s.logins.size).toBe(0)
})

test("a wrong code fails and stores nothing", async () => {
  const s = setup()
  const run = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  const prompt = await s.next("login.prompt")
  s.logins.answer("ws1", "l1", prompt.promptId, "nope")
  await run
  expect(await s.next("login.error")).toMatchObject({ reason: "failed", message: "that code is wrong" })
  expect(await s.store.read(FAKE_PROVIDER)).toBeUndefined()
  expect(s.logins.size).toBe(0)
})

test("cancel ends the login and a late answer hears unknown", async () => {
  const s = setup()
  const run = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  const prompt = await s.next("login.prompt")
  s.logins.cancel("ws1", "l1")
  await run
  expect(await s.next("login.error")).toMatchObject({ reason: "cancelled" })
  s.logins.answer("ws1", "l1", prompt.promptId, FAKE_CODE)
  expect(s.seen().filter((f) => f.t === "login.error").map((f: any) => f.reason)).toEqual(["cancelled", "unknown"])
  expect(await s.store.read(FAKE_PROVIDER)).toBeUndefined()
  expect(s.logins.size).toBe(0)
})

test("an abandoned login, its socket closed, leaves no state and sends nothing", async () => {
  const s = setup()
  const run = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  await s.next("login.prompt")
  const before = s.frames.length
  s.logins.dropOwner("ws1")
  await run
  expect(s.frames.length).toBe(before)
  expect(s.logins.size).toBe(0)
})

test("only the socket that started a login can answer or cancel it", async () => {
  const s = setup()
  const run = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  const prompt = await s.next("login.prompt")
  s.logins.answer("ws2", "l1", prompt.promptId, FAKE_CODE)
  s.logins.cancel("ws2", "l1")
  expect(s.seen("ws2").map((f: any) => f.reason)).toEqual(["unknown", "unknown"])
  expect(s.logins.size).toBe(1)
  s.logins.answer("ws1", "l1", prompt.promptId, FAKE_CODE)
  await run
  await s.next("login.done")
})

test("a second login for the same provider replaces the first", async () => {
  const s = setup()
  const first = s.logins.start("ws1", "l1", FAKE_PROVIDER)
  await s.next("login.prompt")
  const second = s.logins.start("ws1", "l2", FAKE_PROVIDER)
  await first
  expect(await s.next("login.error")).toMatchObject({ loginId: "l1", reason: "cancelled" })
  expect(s.logins.size).toBe(1)
  s.logins.dropOwner("ws1")
  await second
  expect(s.logins.size).toBe(0)
})

test("refusals: no flow, fake off", async () => {
  const s = setup({ fake: false })
  await s.logins.start("ws1", "b", "openrouter")
  await s.logins.start("ws1", "c", "opencode-go")
  await s.logins.start("ws1", "d", FAKE_PROVIDER)
  await s.logins.start("ws1", "e", "../etc")
  expect(s.seen().map((f: any) => [f.loginId, f.reason])).toEqual([
    ["b", "unsupported"],
    ["c", "unsupported"],
    ["d", "unsupported"],
    ["e", "unsupported"],
  ])
  expect(s.logins.size).toBe(0)
})
