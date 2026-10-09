import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Architecture section 24.7. The parts of the extension store that keep secrets and users apart,
// inside workerd. The fetcher is an echo server, so each test sees exactly what would have left yuki.

let mf: Miniflare
let output = ""
const SECRET = `tok-${crypto.randomUUID()}`

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./extension-store-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { CREDENTIALS_KEK: "kek-test-extension-store" },
    durableObjects: { STORE: { className: "StoreDO", useSQLite: true } },
    handleRuntimeStdio(stdout, stderr) {
      stdout.on("data", (c) => (output += String(c)))
      stderr.on("data", (c) => (output += String(c)))
    },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `u${++n}`
type Out = { ok: boolean; value?: any; error?: string; problems?: string[] }
async function call(user: string, op: string, ...args: unknown[]): Promise<Out> {
  const res = await mf.dispatchFetch(`http://x/${user}/call`, { method: "POST", body: JSON.stringify({ op, args }) })
  return (await res.json()) as Out
}
async function seen(user: string) {
  return (await (await mf.dispatchFetch(`http://x/${user}/seen`)).json()) as { sent: { url: string; method: string; headers: Record<string, string>; body: string | null }[]; triggers: string[]; events: string[] }
}

const manifest = {
  yuki: 1,
  name: "hook",
  version: "1.0.0",
  description: "posts",
  tools: { post: { description: "post", effect: "external" } },
  egress: ["api.example.com", "*.cdn.example.com"],
  secrets: { TOKEN: { hosts: ["api.example.com"] } },
  state: "room",
  triggers: [{ id: "daily", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", send: "good morning" }],
}
const bundle = { manifest, files: { "main.js": "export const tools = { post: async () => 'ok' }" } }

async function installed(user: string) {
  const p = await call(user, "propose", { bundle, source: "agent", by: "ada", room: "0190f5e2-7c3a-7b4d-8e9f-0123456789ab" })
  expect(p.ok).toBe(true)
  const i = await call(user, "install", p.value.id)
  expect(i.ok).toBe(true)
  return i.value
}

test("a proposal is not live until install, and install schedules the triggers", async () => {
  const u = fresh()
  const p = await call(u, "propose", { bundle, source: "agent", by: "ada" })
  expect((await call(u, "forAgent", "ada")).value).toEqual([])
  await call(u, "install", p.value.id)
  expect((await call(u, "forAgent", "ada")).value).toEqual([{ name: "hook", hash: p.value.hash }])
  const s = await seen(u)
  expect(s.triggers).toEqual(["cancel ext:hook", "create ext:hook FREQ=DAILY;BYHOUR=9;BYMINUTE=0 [hook] good morning"])
})

test("a secret is filled in only for its own host, and an echo never hands it back", async () => {
  const u = fresh()
  await installed(u)
  await call(u, "setSecret", "hook", "TOKEN", SECRET)
  const out = await call(u, "fetch", "hook", { url: "https://api.example.com/v1?key={{secret.TOKEN}}", headers: { authorization: "Bearer {{secret.TOKEN}}" }, json: { note: "{{secret.TOKEN}}" } })
  expect(out.ok).toBe(true)
  const sent = (await seen(u)).sent.at(-1)!
  expect(sent.url).toBe(`https://api.example.com/v1?key=${SECRET}`)
  expect(sent.headers.authorization).toBe(`Bearer ${SECRET}`)
  expect(sent.method).toBe("POST")
  // The echo carried the secret back three times. The script sees the placeholder, never the value.
  expect(out.value.text).not.toContain(SECRET)
  expect(out.value.text).toContain("{{secret.TOKEN}}")
  expect(out.value.headers["set-cookie"]).toBeUndefined()

  const elsewhere = await call(u, "fetch", "hook", { url: "https://x.cdn.example.com/?k={{secret.TOKEN}}" })
  expect(elsewhere).toMatchObject({ ok: false, error: "secret TOKEN is never sent to x.cdn.example.com" })
  expect(output).not.toContain(SECRET)
})

test("only hosts in egress, only https, and no secret the human has not set", async () => {
  const u = fresh()
  await installed(u)
  expect(await call(u, "fetch", "hook", { url: "https://evil.test/" })).toMatchObject({ ok: false, error: 'evil.test is not in "egress" in extension.json' })
  expect(await call(u, "fetch", "hook", { url: "http://api.example.com/" })).toMatchObject({ ok: false, error: "yuki.fetch only reaches https urls" })
  expect(await call(u, "fetch", "hook", { url: "https://api.example.com/?k={{secret.TOKEN}}" })).toMatchObject({ ok: false })
  expect((await call(u, "fetch", "hook", { url: "https://api.example.com/?k={{secret.TOKEN}}" })).error).toContain("has not set TOKEN")
  expect(await call(u, "fetch", "hook", { url: "https://a.cdn.example.com/" })).toMatchObject({ ok: true })
  expect(await call(u, "fetch", "hook", { url: "https://api.example.com/", headers: { cookie: "x" } })).toMatchObject({ ok: false, error: "header cookie is set by yuki" })
})

test("a switched-off extension reaches nothing, and the agent's scope narrows who runs it", async () => {
  const u = fresh()
  await installed(u)
  await call(u, "setAgents", "hook", ["ben"])
  expect((await call(u, "forAgent", "ada")).value).toEqual([])
  expect((await call(u, "forAgent", "ben")).value).toHaveLength(1)
  await call(u, "setEnabled", "hook", false)
  expect((await call(u, "forAgent", "ben")).value).toEqual([])
  expect(await call(u, "fetch", "hook", { url: "https://api.example.com/" })).toMatchObject({ ok: false, error: "extension hook is not installed and on" })
  expect(await call(u, "state", "hook", "room:r1", "get", "k")).toMatchObject({ ok: false })
})

test("state is kept per scope, and uninstall deletes it with the secrets", async () => {
  const u = fresh()
  await installed(u)
  await call(u, "state", "hook", "room:r1", "set", "count", 3)
  await call(u, "state", "hook", "room:r2", "set", "count", 9)
  expect((await call(u, "state", "hook", "room:r1", "get", "count")).value).toBe(3)
  expect((await call(u, "state", "hook", "room:r1", "list", "co")).value).toEqual(["count"])
  await call(u, "setSecret", "hook", "TOKEN", SECRET)
  await call(u, "uninstall", "hook")
  await installed(u)
  expect((await call(u, "state", "hook", "room:r1", "get", "count")).value).toBe(null)
  expect((await call(u, "list")).value[0].secrets).toEqual([{ name: "TOKEN", set: false }])
})

test("an update keeps the switches and the secret it still declares", async () => {
  const u = fresh()
  await installed(u)
  await call(u, "setEnabled", "hook", false)
  await call(u, "setSecret", "hook", "TOKEN", SECRET)
  const p = await call(u, "propose", { bundle: { ...bundle, manifest: { ...manifest, version: "1.1.0" } }, source: "agent", by: "ada" })
  expect(p.value.replaces).toBeTruthy()
  const info = (await call(u, "install", p.value.id)).value
  expect(info).toMatchObject({ version: "1.1.0", enabled: false, secrets: [{ name: "TOKEN", set: true }] })
})

test("users never share an extension", async () => {
  const a = fresh()
  const b = fresh()
  await installed(a)
  expect((await call(b, "list")).value).toEqual([])
  expect(await call(b, "fetch", "hook", { url: "https://api.example.com/" })).toMatchObject({ ok: false })
})
