import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url), { "process.env.NODE_ENV": '"development"' }),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars", CREDENTIALS_KEK: "test-kek-at-least-32-characters-long" },
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `health${++n}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

type Frame = { t: string; what?: string; loginId?: string; promptId?: string }

async function socket(user: string) {
  const origin = (await mf.ready).origin
  const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${user}`)
  const frames: Frame[] = []
  ws.onmessage = (e) => void frames.push(JSON.parse(String(e.data)))
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
  const wait = async (pick: (f: Frame) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const found = frames.find(pick)
      if (found) return found
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`no frame. got ${JSON.stringify(frames)}`)
  }
  await wait((f) => f.t === "reset" || f.t === "events")
  return {
    wait,
    send: (frame: unknown) => ws.send(JSON.stringify(frame)),
    changes: () => frames.filter((f) => f.t === "changed" && f.what === "providers").length,
    close: () => ws.close(),
  }
}

async function signIn(user: string) {
  const ws = await socket(user)
  ws.send({ t: "login.start", loginId: "l1", provider: "kiko-fake" })
  const prompt = await ws.wait((f) => f.t === "login.prompt")
  ws.send({ t: "login.answer", loginId: "l1", promptId: prompt.promptId, value: "KIKO-0000" })
  await ws.wait((f) => f.t === "login.done")
  return ws
}

const providerRow = async (user: string, id: string) => (await rpc(user, "listProviders")).find((p: { provider: string }) => p.provider === id)
const settle = () => new Promise((r) => setTimeout(r, 150))

test("a refused refresh marks the sign-in expired once, and a good check clears it", async () => {
  const user = fresh()
  const ws = await signIn(user)
  expect(await providerRow(user, "kiko-fake")).not.toHaveProperty("problem")
  await rpc(user, "devProviderHealth", { refresh: "fail" })

  const turn = await rpc(user, "turnContext", "kiko-fake")
  expect(turn).toMatchObject({ auth: null, authProblem: "signed_out", credential: "oauth" })
  expect(await providerRow(user, "kiko-fake")).toMatchObject({ kind: "oauth", problem: "signed_out" })
  await rpc(user, "turnContext", "kiko-fake")
  await settle()
  expect(ws.changes()).toBe(1)

  await rpc(user, "devProviderHealth", { refresh: "ok" })
  const checked = await rpc(user, "checkProvider", "kiko-fake")
  expect(checked.problem).toBeUndefined()
  expect(await providerRow(user, "kiko-fake")).not.toHaveProperty("problem")
  await settle()
  expect(ws.changes()).toBe(2)
  ws.close()
})

test("a refresh that cannot reach the server is not a problem with the sign-in", async () => {
  const user = fresh()
  const ws = await signIn(user)
  await rpc(user, "devProviderHealth", { refresh: "offline" })
  const turn = await rpc(user, "turnContext", "kiko-fake")
  expect(turn).toMatchObject({ auth: null, authProblem: "unreachable" })
  expect((await rpc(user, "checkProvider", "kiko-fake")).problem).toBeUndefined()
  expect(await providerRow(user, "kiko-fake")).not.toHaveProperty("problem")
  await settle()
  expect(ws.changes()).toBe(0)
  await rpc(user, "devProviderHealth", { refresh: "ok" })
  ws.close()
})

test("the six-hourly refresh finds a revoked sign-in before a run does", async () => {
  const user = fresh()
  const ws = await signIn(user)
  await rpc(user, "devProviderHealth", { refresh: "fail", wake: true })
  expect(await providerRow(user, "kiko-fake")).toMatchObject({ problem: "signed_out" })
  await rpc(user, "devProviderHealth", { refresh: "ok", wake: true })
  expect(await providerRow(user, "kiko-fake")).not.toHaveProperty("problem")
  ws.close()
})

test("a run's refusal, an empty balance, a recovery and a new key move the problem, and a limit does not", async () => {
  const user = fresh()
  const ws = await socket(user)
  await rpc(user, "connectProvider", "opencode-go", "sk-test-health-key-0001")
  expect(await providerRow(user, "opencode-go")).not.toHaveProperty("problem")

  await rpc(user, "recordProviderProblem", "opencode-go", "rate_limit")
  await rpc(user, "recordProviderProblem", "opencode-go", "overloaded")
  expect(await providerRow(user, "opencode-go")).not.toHaveProperty("problem")

  await rpc(user, "recordProviderProblem", "opencode-go", "invalid_key")
  const refused = await providerRow(user, "opencode-go")
  expect(refused.problem).toBe("key_refused")
  expect(refused.problemAt).toBeGreaterThan(0)
  await rpc(user, "recordProviderProblem", "opencode-go", "invalid_key")
  await rpc(user, "recordProviderProblem", "opencode-go", "quota")
  expect((await providerRow(user, "opencode-go")).problem).toBe("no_credit")

  await rpc(user, "providerRecovered", "opencode-go")
  expect(await providerRow(user, "opencode-go")).not.toHaveProperty("problem")
  await rpc(user, "providerRecovered", "opencode-go")

  await rpc(user, "recordProviderProblem", "opencode-go", "invalid_key")
  await rpc(user, "connectProvider", "opencode-go", "sk-test-health-key-0002")
  expect(await providerRow(user, "opencode-go")).not.toHaveProperty("problem")
  await settle()
  expect(ws.changes()).toBe(5)
  ws.close()
})

test("a problem for a provider that is not connected is dropped", async () => {
  const user = fresh()
  await rpc(user, "recordProviderProblem", "anthropic", "invalid_key")
  expect(await rpc(user, "listProviders")).toEqual([])
})

test("a run's turn carries the stored problem and the credential kind, so the agent can report and recover", async () => {
  const user = fresh()
  await rpc(user, "connectProvider", "opencode-go", "sk-test-health-key-0003")
  await rpc(user, "setAgentModel", "kiko", "opencode-go/deepseek-v4.1-flash", null, null)
  expect(await rpc(user, "agentTurn", "kiko")).toMatchObject({ provider: "opencode-go", credential: "api_key" })
  expect(await rpc(user, "agentTurn", "kiko")).not.toHaveProperty("problem")
  await rpc(user, "recordProviderProblem", "opencode-go", "quota")
  const turn = await rpc(user, "agentTurn", "kiko")
  expect(turn).toMatchObject({ provider: "opencode-go", problem: "no_credit" })
  expect(turn.auth).not.toBeNull()
})
