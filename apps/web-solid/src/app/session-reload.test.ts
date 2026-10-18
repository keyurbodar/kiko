import { expect, test } from "bun:test"

const root = new URL(".", import.meta.url).pathname
const script = `
import { spyOn } from "bun:test"
const root = Bun.argv[1]
const phase = Bun.argv[2]
const values = new Map(JSON.parse(Bun.argv[3]))
Object.assign(globalThis, { localStorage: {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    if (phase === "storage-denied" && key === "kiko:pending-cleanup") throw new Error("Storage denied")
    values.set(key, value)
  },
  removeItem: (key) => values.delete(key),
} })
let deletes = 0
let requests = 0
Object.assign(globalThis, { indexedDB: {
  databases: async () => [{ name: "kiko:warm:owner" }],
  deleteDatabase: () => {
    deletes++
    const request = {}
    queueMicrotask(() => phase === "login-unblocked" ? request.onsuccess() : request.onblocked())
    return request
  },
} })
spyOn(await import(root + "clerk.ts"), "clerkSignIn").mockResolvedValue({
  token: "test-clerk-B", userId: "clerk-B", backendUrl: "https://b.workers.dev",
  profile: { name: "B", email: "", imageUrl: "", provider: null },
})
globalThis.fetch = async () => {
  requests++
  return Response.json({ user: { id: "owner", name: "B" }, token: "test-session-B" })
}
const auth = await import(root + "session.ts")
let refused = false
try {
  if (phase === "logout") await auth.signOut()
  else if (phase === "access-code") await auth.signInWithAccessCode("test-code")
  else if (phase === "boot") await auth.bootstrapSession()
  else await auth.signInWithClerk()
} catch { refused = true }
console.log(JSON.stringify({ refused, deletes, requests, state: auth.session().status, storage: [...values] }))
process.exit(0)
`

function run(phase: string, storage: [string, string][]) {
  const child = Bun.spawnSync([process.execPath, "--eval", script, root, phase, JSON.stringify(storage)])
  expect(child.exitCode).toBe(0)
  return JSON.parse(child.stdout.toString()) as {
    refused: boolean; deletes: number; requests: number; state: string; storage: [string, string][]
  }
}

test("reload cannot bypass another owner's blocked warm-cache cleanup", () => {
  const logout = run("logout", [
    ["kiko:session", JSON.stringify({ id: "owner", name: "A" })],
    ["kiko:identity", JSON.stringify(["clerk-A", "https://a.workers.dev"])],
    ["kiko:backend", "https://a.workers.dev"],
    ["kiko:token", "test-session-A"],
  ])
  expect(logout.refused).toBe(true)
  expect(logout.deletes).toBe(1)
  const reloaded = run("login", logout.storage)
  expect(reloaded.refused).toBe(true)
  expect(reloaded.deletes).toBe(1)
  expect(reloaded.requests).toBe(0)
  expect(reloaded.state).toBe("signed-out")
  const retried = run("login-unblocked", reloaded.storage)
  expect(retried.refused).toBe(false)
  expect(retried.deletes).toBe(1)
  expect(retried.requests).toBe(1)
  expect(retried.state).toBe("signed-in")
})


test("identity adoption stops when required cache cleanup cannot be recorded", () => {
  const result = run("storage-denied", [
    ["kiko:session", JSON.stringify({ id: "owner", name: "A" })],
    ["kiko:identity", JSON.stringify(["clerk-A", "https://a.workers.dev"])],
    ["kiko:backend", "https://a.workers.dev"],
    ["kiko:token", "test-session-A"],
  ])
  expect(result.refused).toBe(true)
  expect(result.requests).toBe(0)
  expect(new Map(result.storage).get("kiko:identity")).toBe(JSON.stringify(["clerk-A", "https://a.workers.dev"]))
})


for (const phase of ["access-code", "boot"]) {
  test(`${phase} cannot adopt a session while persisted cleanup is blocked`, () => {
    const result = run(phase, [["kiko:pending-cleanup", JSON.stringify(["owner"])]])
    expect(result.deletes).toBe(1)
    expect(result.requests).toBe(1)
    expect(result.state).toBe("signed-out")
    expect(new Map(result.storage).has("kiko:token")).toBe(false)
  })
}
