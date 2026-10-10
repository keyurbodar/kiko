import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { pickJudge } from "../src/user/turn-context"
import { bundleWorker } from "./bundle"

// The real UserDO in workerd: which capture policy fills the queue, what agents are told through
// turnContext, and how a note corrects a life line.
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url), { "process.env.NODE_ENV": '"development"' }),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { CREDENTIALS_KEK: `kek-${crypto.randomUUID()}` },
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `cap${++n}${Date.now().toString(36)}`
const ROOM = "01J0000000000000000000000A"

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

const fact = (id: string) => [{ messageId: id, text: "My sister Sam is a nurse in Leeds.", at: Date.now() }]
const policy = (user: string, p: Record<string, unknown>) => rpc(user, "devSetting", "memory_policy", JSON.stringify({ jevDelayMs: 600_000, idleMs: 600_000, ...p }))

test("auto capture without a judge queues nothing and tells agents to note; always queues and says capture is on", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM, "plans")
  await policy(user, {})
  await rpc(user, "captureHuman", ROOM, fact("m1"))
  expect(await rpc(user, "devCaptureQueue")).toBe(0)
  expect((await rpc(user, "turnContext", "anthropic")).captures).toBe(false)

  await policy(user, { capture: "always" })
  await rpc(user, "captureHuman", ROOM, fact("m2"))
  expect(await rpc(user, "devCaptureQueue")).toBe(1)
  expect((await rpc(user, "turnContext", "anthropic")).captures).toBe(true)

  await policy(user, { capture: "off" })
  await rpc(user, "captureHuman", ROOM, fact("m3"))
  expect(await rpc(user, "devCaptureQueue")).toBe(1)
  expect((await rpc(user, "turnContext", "anthropic")).captures).toBe(false)
})

test("a judge-only key turns auto capture on, and a chat key that also lists classifier models does not", async () => {
  const user = fresh()
  await rpc(user, "createChat", ROOM, "plans")
  await policy(user, {})
  await rpc(user, "connectProvider", "opencode", `sk-test-${crypto.randomUUID()}`)
  await rpc(user, "captureHuman", ROOM, fact("m1"))
  expect(await rpc(user, "devCaptureQueue")).toBe(0)
  expect((await rpc(user, "turnContext", "opencode")).captures).toBe(false)

  await rpc(user, "connectProvider", "typesafe", `ts-test-${crypto.randomUUID()}`)
  await rpc(user, "captureHuman", ROOM, fact("m2"))
  expect(await rpc(user, "devCaptureQueue")).toBe(1)
  expect((await rpc(user, "turnContext", "opencode")).captures).toBe(true)
  const listed = (await rpc(user, "listProviders")) as { provider: string; chat: boolean; judge: boolean }[]
  expect(listed.map(({ provider, chat, judge }) => ({ provider, chat, judge }))).toEqual([
    { provider: "opencode", chat: true, judge: true },
    { provider: "typesafe", chat: false, judge: true },
  ])

  await rpc(user, "disconnectProvider", "typesafe")
  expect(await rpc(user, "devCaptureQueue")).toBe(0)
  expect((await rpc(user, "turnContext", "opencode")).captures).toBe(false)
})

test("a note with replaces supersedes that live line, and a line no longer live is not replaced again", async () => {
  const user = fresh()
  expect(await rpc(user, "lifeNote", "ada", "the human lives in bangalore", false)).toEqual({ ok: true, pos: 0 })
  expect(await rpc(user, "lifeNote", "ada", "the human moved to pune", false, "", "life:0")).toEqual({ ok: true, pos: 1, replaced: true })
  expect(await rpc(user, "lifeRecall", "bangalore")).toEqual([])
  expect(((await rpc(user, "lifeRecall", "pune")) as string[]).join()).toContain("the human moved to pune")
  expect(await rpc(user, "lifeNote", "ada", "the human moved to mumbai", false, "", "life:0")).toEqual({ ok: true, pos: 2, replaced: false })
  expect(await rpc(user, "lifeNote", "ada", "the human likes tea", false, "", "chat:1")).toEqual({ ok: true, pos: 3, replaced: false })
  expect(((await rpc(user, "lifeRecall", "pune")) as string[]).length).toBe(1)
})

test("the judge is the connected judge-only provider, or a chat provider only when the setting names it", () => {
  const keys = [{ provider: "anthropic" }, { provider: "opencode" }, { provider: "typesafe" }]
  expect(pickJudge(keys, () => false)).toEqual({ key: { provider: "typesafe" }, model: null })
  expect(pickJudge(keys.slice(0, 2), () => false)).toBeNull()
  expect(pickJudge(keys, (p) => p.provider === "typesafe")).toBeNull()
  expect(pickJudge(keys, () => false, "opencode/jev-1.13-free")).toEqual({ key: { provider: "opencode" }, model: "jev-1.13-free" })
  expect(pickJudge(keys, () => false, "anthropic/claude")).toEqual({ key: { provider: "typesafe" }, model: null })
  expect(pickJudge(keys, () => false, "jev-latest")).toEqual({ key: { provider: "typesafe" }, model: "jev-latest" })
})
