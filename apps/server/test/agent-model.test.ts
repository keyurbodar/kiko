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
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars", CREDENTIALS_KEK: `kek-${crypto.randomUUID()}` },
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `am${++n}${Date.now().toString(36)}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

const REASONER = "anthropic/claude-opus-4-6"
const PLAIN = "openai/gpt-4o"

test("a model set from one chat is the agent's model in every chat, and only that agent's", async () => {
  const user = fresh()
  const kikoBefore = await rpc(user, "agentModel", "kiko")
  await rpc(user, "setAgentModel", "ada", REASONER, "high", null)
  const ada = await rpc(user, "agentModel", "ada")
  expect(ada).toMatchObject({ model: REASONER, thinking: "high" })
  expect(ada.thinkingLevels).toContain("max")
  expect(ada.thinkingLevels).not.toContain("xhigh")
  expect(await rpc(user, "agentModel", "kiko")).toEqual(kikoBefore)
})

test("the model and level a run uses come from the user in one call", async () => {
  const user = fresh()
  await rpc(user, "setAgentModel", "kiko", REASONER, "medium", null)
  const turn = await rpc(user, "agentTurn", "kiko")
  expect(turn).toMatchObject({ model: REASONER, thinking: "medium", provider: "anthropic" })
})

test("a level the model lacks is clamped, a model that cannot reason runs at off, and an unknown model is refused", async () => {
  const user = fresh()
  await rpc(user, "setAgentModel", "ada", REASONER, "xhigh", null)
  expect((await rpc(user, "agentModel", "ada")).thinking).toBe("max")
  await rpc(user, "setAgentModel", "ada", PLAIN, null, null)
  expect(await rpc(user, "agentModel", "ada")).toMatchObject({ model: PLAIN, thinking: "off", thinkingLevels: ["off"] })
  expect(await rpc(user, "setAgentModel", "ada", "nowhere/nothing", null, null)).toBeNull()
  expect((await rpc(user, "agentModel", "ada")).model).toBe(PLAIN)
})

test("changing only the level keeps the model, and a new agent starts on Kiko's model", async () => {
  const user = fresh()
  await rpc(user, "setAgentModel", "kiko", REASONER, "low", null)
  await rpc(user, "setAgentModel", "kiko", null, "high", null)
  expect(await rpc(user, "agentModel", "kiko")).toMatchObject({ model: REASONER, thinking: "high" })
  await rpc(user, "makeAgent", { name: "Bo", slug: "bo", description: "", soul: "bo", model: "" })
  expect((await rpc(user, "agentModel", "bo")).model).toBe(REASONER)
})

const KEY = () => `sk-${crypto.randomUUID().replaceAll("-", "")}`

test("an agent the owner never gave a model runs on a connected provider's model, not on one they have no key for", async () => {
  const user = fresh()
  expect((await rpc(user, "agentModel", "kiko")).model).toStartWith("opencode-go/")
  await rpc(user, "connectProvider", "anthropic", KEY())
  const kiko = await rpc(user, "agentModel", "kiko")
  expect(kiko.model).toStartWith("anthropic/")
  expect((await rpc(user, "agentTurn", "kiko")).provider).toBe("anthropic")
  await rpc(user, "makeAgent", { name: "Bo", slug: "bo", description: "", soul: "bo", model: "" })
  expect((await rpc(user, "agentModel", "bo")).model).toStartWith("anthropic/")
})

test("the default model stays when its provider is connected, and an explicit pick is never replaced", async () => {
  const user = fresh()
  await rpc(user, "connectProvider", "anthropic", KEY())
  await rpc(user, "connectProvider", "opencode-go", KEY())
  expect((await rpc(user, "agentModel", "kiko")).model).toStartWith("opencode-go/")
  await rpc(user, "setAgentModel", "kiko", PLAIN, null, null)
  await rpc(user, "disconnectProvider", "opencode-go")
  expect((await rpc(user, "agentModel", "kiko")).model).toBe(PLAIN)
})

test("with no key at all the default model stays, so the run says which key is missing", async () => {
  const user = fresh()
  await rpc(user, "connectProvider", "anthropic", KEY())
  await rpc(user, "disconnectProvider", "anthropic")
  expect((await rpc(user, "agentTurn", "kiko")).model).toStartWith("opencode-go/")
})
