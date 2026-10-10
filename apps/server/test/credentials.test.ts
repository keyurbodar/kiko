import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import { CryptoError, type Keyring, keyringFromEnv, open, seal } from "@yuki/durable/crypto"

const random = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")
const V1: Keyring = { current: { version: 1, secret: `kek-one-${random()}` } }
const V2: Keyring = { current: { version: 2, secret: `kek-two-${random()}` }, previous: V1.current }
const V2_ONLY: Keyring = { current: V2.current }
const keys: string[] = []
const newKey = () => {
  const key = `sk-test-${random()}`
  keys.push(key)
  return key
}

let mf: Miniflare
let output = ""

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./credentials-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { CREDENTIALS_KEK: V1.current.secret },
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      VAULT: { className: "VaultDO", useSQLite: true },
    },
    handleRuntimeStdio(stdout, stderr) {
      stdout.on("data", (chunk) => (output += String(chunk)))
      stderr.on("data", (chunk) => (output += String(chunk)))
    },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `cred${++n}${random().slice(0, 6)}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  const text = await res.text()
  for (const key of keys) expect(text).not.toContain(key)
  return JSON.parse(text) as { result?: any; error?: string }
}

async function vault(user: string, body: Record<string, unknown>) {
  const res = await mf.dispatchFetch(`http://do/vault/${user}`, { method: "POST", body: JSON.stringify(body) })
  return (await res.json()) as { result?: any; error?: string }
}

test("a sealed key opens only for the same user and provider", async () => {
  const key = newKey()
  const sealed = await seal(V1, "alice", "opencode-go", key)
  expect(sealed.iv.length).toBe(12)
  expect(sealed.kekVersion).toBe(1)
  expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain(key)
  expect(await open(V1, "alice", "opencode-go", sealed)).toBe(key)

  const wrongUser = await open(V1, "bob", "opencode-go", sealed).catch((e) => e)
  expect(wrongUser).toBeInstanceOf(CryptoError)
  expect(String(wrongUser)).not.toContain(key)
  expect(await open(V1, "alice", "anthropic", sealed).catch((e) => e)).toBeInstanceOf(CryptoError)
  const other = { current: { version: 1, secret: "another-kek" } }
  expect(await open(other, "alice", "opencode-go", sealed).catch((e) => e)).toBeInstanceOf(CryptoError)

  const again = await seal(V1, "alice", "opencode-go", key)
  expect(Buffer.from(again.iv).equals(Buffer.from(sealed.iv))).toBe(false)
})

test("the keyring reads its version and the previous secret from env", () => {
  expect(keyringFromEnv({ CREDENTIALS_KEK: "a" })).toEqual({ current: { version: 1, secret: "a" } })
  expect(keyringFromEnv({ CREDENTIALS_KEK: "b", CREDENTIALS_KEK_VERSION: "3", CREDENTIALS_KEK_PREVIOUS: "a" })).toEqual({
    current: { version: 3, secret: "b" },
    previous: { version: 2, secret: "a" },
  })
  expect(() => keyringFromEnv({ CREDENTIALS_KEK: "" })).toThrow(CryptoError)
})

test("connect, list, and disconnect through the real UserDO return no key", async () => {
  const user = fresh()
  const key = newKey()
  const info = await rpc(user, "connectProvider", "opencode-go", key)
  expect(info.result).toEqual({ provider: "opencode-go", kind: "api_key", last4: key.slice(-4), chat: true, judge: false })
  expect((await rpc(user, "listProviders")).result).toEqual([info.result])

  expect((await rpc(fresh(), "listProviders")).result).toEqual([])

  const next = newKey()
  await rpc(user, "connectProvider", "opencode-go", next)
  expect((await rpc(user, "listProviders")).result).toEqual([{ provider: "opencode-go", kind: "api_key", last4: next.slice(-4), chat: true, judge: false }])

  expect((await rpc(user, "disconnectProvider", "opencode-go")).result).toBe(true)
  expect((await rpc(user, "listProviders")).result).toEqual([])
  expect((await rpc(user, "disconnectProvider", "opencode-go")).result).toBe(false)
})

test("connect refuses a bad provider id or an empty key", async () => {
  const user = fresh()
  expect((await rpc(user, "connectProvider", "../user:other", newKey())).error).toContain("bad provider id")
  expect((await rpc(user, "connectProvider", "opencode-go", "  ")).error).toContain("api key is empty")
  expect((await rpc(user, "listProviders")).result).toEqual([])
})

test("a key sealed with the previous kek opens during rotation and is re-sealed", async () => {
  const user = fresh()
  const key = newKey()
  await vault(user, { keyring: V1, op: "connect", provider: "opencode-go", apiKey: key })
  expect((await vault(user, { keyring: V1, op: "versions" })).result).toEqual([{ provider_id: "opencode-go", kek_version: 1 }])

  expect((await vault(user, { keyring: V2_ONLY, op: "read", provider: "opencode-go" })).error).toContain("kek version 1")

  const read = await vault(user, { keyring: V2, op: "read", provider: "opencode-go" })
  expect(read.result).toEqual({ type: "api_key", key })
  expect((await vault(user, { keyring: V2, op: "versions" })).result).toEqual([{ provider_id: "opencode-go", kek_version: 2 }])

  expect((await vault(user, { keyring: V2_ONLY, op: "read", provider: "opencode-go" })).result).toEqual({ type: "api_key", key })
})

test("no key the suite stored appears in the workerd log", async () => {
  const canary = `canary${random()}`
  await mf.dispatchFetch(`http://do/log/x/${canary}`)
  const end = Date.now() + 2000
  while (!output.includes(canary) && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
  expect(output).toContain(canary)
  expect(output).toContain("rpc connectProvider")
  expect(keys.length).toBeGreaterThan(3)
  for (const key of keys) expect(output).not.toContain(key)
})
