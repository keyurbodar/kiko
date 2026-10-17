import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { userModels } from "../src/agent/factory"
import { applyOverlay, findProvider, setOverlay } from "../src/models/catalog"
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
const fresh = () => `mo${++n}${Date.now().toString(36)}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

const BASE = { ...findProvider("opencode-go")!.getModels()[0]! }
const MODEL = { ...BASE, id: "only-in-the-overlay", name: "Only in the overlay" }
const REF = "opencode-go/only-in-the-overlay"

test("a model only in the overlay is refused until the overlay has it, then it can be set and a run's AgentDO resolves it", async () => {
  const user = fresh()
  expect(await rpc(user, "setAgentModel", "ada", REF, null, null)).toBeNull()

  await rpc(user, "devModelOverlay", { "opencode-go": [MODEL] })
  const set = await rpc(user, "setAgentModel", "ada", REF, null, null)
  expect(set).toMatchObject({ model: REF })

  const turn = await rpc(user, "agentTurn", "ada")
  expect(turn).toMatchObject({ model: REF, provider: "opencode-go" })
  expect(turn.catalog.models.map((m: { id: string }) => m.id)).toEqual(["only-in-the-overlay"])
  expect(turn.catalog.revision).toBeTruthy()

  setOverlay("opencode-go", [])
  applyOverlay({})
  const agentSide = userModels(async () => undefined, "session")
  expect(agentSide.models.getModel("opencode-go", "only-in-the-overlay")).toBeUndefined()
  setOverlay(turn.provider, turn.catalog.models)
  expect(agentSide.models.getModel("opencode-go", "only-in-the-overlay")?.name).toBe("Only in the overlay")
})

test("the client's catalog lists an overlay model and changes revision with it", async () => {
  const user = fresh()
  await rpc(user, "devModelOverlay", {})
  const before = await rpc(user, "modelCatalog", null)
  await rpc(user, "devModelOverlay", { "opencode-go": [MODEL] })
  const after = await rpc(user, "modelCatalog", null)
  expect(after.revision).not.toBe(before.revision)
  const listed = JSON.parse(after.json).providers.find((p: { id: string }) => p.id === "opencode-go").models.map((m: { id: string }) => m.id)
  expect(listed).toContain("only-in-the-overlay")
  expect(JSON.parse(before.json).providers.find((p: { id: string }) => p.id === "opencode-go").models.map((m: { id: string }) => m.id)).not.toContain("only-in-the-overlay")
  expect(await rpc(user, "modelCatalog", after.revision)).toEqual({ revision: after.revision, json: null })
})

test("the catalog offers only the sign-ins the server runs", async () => {
  const user = fresh()
  await rpc(user, "devModelOverlay", {})
  const catalog = JSON.parse((await rpc(user, "modelCatalog", null)).json) as { providers: { id: string; connect: string[]; signIn?: { method: string; label: string } }[] }
  const connect = (id: string) => catalog.providers.find((p) => p.id === id)?.connect
  const signIn = (id: string) => catalog.providers.find((p) => p.id === id)?.signIn
  expect(signIn("openai")).toEqual({ method: "paste_code", label: "Sign in with ChatGPT" })
  expect(signIn("xai")).toEqual({ method: "device_code", label: "Sign in with SuperGrok or X Premium" })
  expect(signIn("anthropic")?.label).toContain("Claude Pro/Max")
  expect(signIn("opencode-go")).toBeUndefined()
  expect(connect("anthropic")).toContain("paste_code")
  expect(connect("github-copilot")).toContain("device_code")
  expect(connect("opencode-go")).toEqual(["api_key"])
  expect(connect("openrouter")).not.toContain("device_code")
  expect(connect("openrouter")).not.toContain("paste_code")
})
