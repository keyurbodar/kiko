import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test"

const originalFetch = globalThis.fetch
const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
afterAll(() => {
  globalThis.fetch = originalFetch
  if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB)
  else Reflect.deleteProperty(globalThis, "indexedDB")
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage)
  else Reflect.deleteProperty(globalThis, "localStorage")
  mock.restore()
})
const store = new Map<string, string>()
Object.assign(globalThis, { localStorage: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
} })
let backendUrl: string | null = "https://other.workers.dev"
spyOn(await import("./clerk"), "clerkSignIn").mockImplementation(async () => ({ token: "test-clerk", userId: "clerk-user", backendUrl, profile: { name: "New owner", email: "", imageUrl: "", provider: null } }))
const { bootstrapSession, signOut, signInWithClerk, signInAsDev, session, backendConnectionNotice } = await import("./session")
const { getToken, setToken } = await import("../lib/api-base")
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let status = 403
let message = "This backend belongs to someone else"
let probes = 0
let exchangeAuthorization: string | null = null
beforeEach(async () => {
  store.clear()
  backendUrl = "https://other.workers.dev"
  status = 403
  message = "This backend belongs to someone else"
  probes = 0
  Object.assign(globalThis, { fetch: mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/api/auth/dev/session")) return json({ user: { id: "old", name: "Old owner" }, token: "old-session" })
    if (url.endsWith("/api/version")) { probes++; return json({ version: "0.4.4" }) }
    exchangeAuthorization = new Headers(init?.headers).get("authorization")
    return json({ message }, status)
  }) })
  await signInAsDev()
  setToken("old-session")
  store.set("kiko:backend", "https://stale.workers.dev")
  store.set("kiko:snap", "old snapshot")
  store.set("kiko:file-token", "old-file")
})

test("a verified owner mismatch recovers to connect and removes the previous backend session", async () => {
  expect(await signInWithClerk()).toBe("connect")
  expect(backendConnectionNotice()).toContain("another Kiko account")
  expect(session().status).toBe("signed-out")
  expect(getToken()).toBeNull()
  for (const key of ["kiko:backend", "kiko:session", "kiko:snap", "kiko:file-token"]) expect(store.get(key)).toBeUndefined()
  expect(exchangeAuthorization).toBeNull()
})

test("expired and invalid 401s stay authentication failures, even with owner-like text", async () => {
  status = 401
  for (const text of ["That token has expired", "That token is not valid", "This backend belongs to someone else"]) {
    message = text
    await expect(signInWithClerk()).rejects.toThrow(text)
  }
  expect(probes).toBe(0)
})

test("an unrelated forbidden response does not become owner recovery", async () => {
  message = "Forbidden"
  await expect(signInWithClerk()).rejects.toThrow("Forbidden")
})

test("switching to an account without metadata never reuses the old address or session", async () => {
  backendUrl = null
  expect(await signInWithClerk()).toBe("connect")
  expect(session().status).toBe("signed-out")
  expect(getToken()).toBeNull()
  expect(store.get("kiko:backend")).toBeUndefined()
})


test("the rightful owner adopts only the backend exchange's new session", async () => {
  Object.assign(globalThis, { fetch: mock(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBeNull()
    return json({ user: { id: "owner", name: "Owner" }, token: "new-session" })
  }) })
  expect(await signInWithClerk()).toBe("in")
  expect(getToken()).toBe("new-session")
  expect(session()).toEqual({ status: "signed-in", user: { id: "owner", name: "Owner" } })
  expect(backendConnectionNotice()).toBe("")
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("late boot me success cannot restore a signed-out session", async () => {
  const pending = deferred<Response>()
  globalThis.__kikoBoot = { me: pending.promise, token: getToken(), url: "https://stale.workers.dev/api/me" }
  const boot = bootstrapSession()
  await signOut()
  pending.resolve(json({ user: { id: "old", name: "Old" } }))
  await boot
  expect(session().status).toBe("signed-out")
})

test("late boot me 401 cannot discard a newer sign-in", async () => {
  const pending = deferred<Response>()
  globalThis.__kikoBoot = { me: pending.promise, token: getToken(), url: "https://stale.workers.dev/api/me" }
  const boot = bootstrapSession()
  await signInAsDev()
  pending.resolve(json({}, 401))
  await boot
  expect(session().status).toBe("signed-in")
  expect(getToken()).toBe("old-session")
})

test("late Clerk exchange cannot undo sign-out", async () => {
  const pending = deferred<Response>()
  const started = deferred<void>()
  Object.assign(globalThis, { fetch: mock(() => { started.resolve(); return pending.promise }) })
  const exchange = signInWithClerk()
  await started.promise
  await signOut()
  pending.resolve(json({ user: { id: "owner", name: "Owner" }, token: "late-session" }))
  await exchange
  expect(session().status).toBe("signed-out")
  expect(getToken()).toBeNull()
})

test("same Clerk account and backend preserves warm startup during re-exchange", async () => {
  Object.assign(globalThis, { fetch: mock(async () => json({ user: { id: "owner", name: "Owner" }, token: "first-session" })) })
  await signInWithClerk()
  store.set("kiko:snap", "warm snapshot")
  const pending = deferred<Response>()
  const started = deferred<void>()
  Object.assign(globalThis, { fetch: mock(() => { started.resolve(); return pending.promise }) })
  const exchange = signInWithClerk()
  await started.promise
  expect(session().status).toBe("signed-in")
  expect(store.get("kiko:snap")).toBe("warm snapshot")
  pending.resolve(json({ user: { id: "owner", name: "Owner" }, token: "second-session" }))
  await exchange
  expect(getToken()).toBe("second-session")
})

 test("an expired backend session still allows Clerk to resume", async () => {
  const { allowClerkResume, autoResume } = await import("./session")
  allowClerkResume()
  Object.assign(globalThis, { fetch: mock(async () => json({}, 401)) })
  await bootstrapSession()
  expect(autoResume()).toBe(true)
})


test("blocked cache cleanup can be retried before adopting another owner", async () => {
  let blocked = true
  let deletes = 0
  Object.assign(globalThis, { indexedDB: {
    databases: async () => [{ name: "kiko:warm:old" }],
    deleteDatabase: () => {
      deletes++
      const request = {} as IDBOpenDBRequest
      queueMicrotask(() => (blocked ? request.onblocked : request.onsuccess)?.call(request, {} as Event & IDBVersionChangeEvent))
      return request
    },
  } })
  await expect(signOut()).rejects.toThrow("Close other Kiko tabs")
  blocked = false
  Object.assign(globalThis, { fetch: mock(async () => json({ user: { id: "owner", name: "New" }, token: "new" })) })
  expect(await signInWithClerk()).toBe("in")
  expect(deletes).toBe(2)
  expect(getToken()).toBe("new")
  Reflect.deleteProperty(globalThis, "indexedDB")
})

test("installed backend adoption preserves the active setup while exchanging", async () => {
  const { signInToInstalledBackend, authReset } = await import("./session")
  backendUrl = null
  await signInWithClerk()
  store.set("kiko:backend", "https://new.workers.dev")
  const resets = authReset()
  const pending = deferred<Response>()
  const started = deferred<void>()
  let requested = ""
  Object.assign(globalThis, { fetch: mock((input: string | URL | Request) => { requested = String(input); started.resolve(); return pending.promise }) })
  const exchange = signInToInstalledBackend()
  await started.promise
  expect(authReset()).toBe(resets)
  pending.resolve(json({ user: { id: "owner", name: "New" }, token: "installed" }))
  await exchange
  expect(getToken()).toBe("installed")
  expect(requested).toBe("https://new.workers.dev/api/auth/clerk")
  expect(store.get("kiko:backend")).toBe("https://new.workers.dev")
  expect(authReset()).toBe(resets)
})


test("an unauthenticated boot does not reset an active installation callback", async () => {
  const { authReset } = await import("./session")
  await signOut()
  const resets = authReset()
  Object.assign(globalThis, { fetch: mock(async () => json({}, 401)) })
  await bootstrapSession()
  expect(authReset()).toBe(resets)
})


test("access-code sign-in keeps the configured backend after sign-out", async () => {
  const { signInWithAccessCode } = await import("./session")
  store.set("kiko:backend", "https://configured.workers.dev")
  await signOut()
  let requested = ""
  Object.assign(globalThis, { fetch: mock(async (input: string | URL | Request) => {
    requested = String(input)
    return json({ user: { id: "owner", name: "Owner" }, token: "access-session" })
  }) })
  await signInWithAccessCode("test-access-code")
  expect(requested).toBe("https://configured.workers.dev/api/auth/access-code")
  expect(getToken()).toBe("access-session")
})
