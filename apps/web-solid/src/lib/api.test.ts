import { afterEach, beforeEach, expect, test } from "bun:test"

const store = new Map<string, string>()
const sent: { url: string; headers: Headers }[] = []
let status = 200

beforeEach(() => {
  store.clear()
  sent.length = 0
  status = 200
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { origin: "http://localhost:5173" },
    fetch: async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers) })
      return new Response("{}", { status })
    },
  })
})
afterEach(() => import("./api").then((api) => api.setToken(null)))

test("with no backend stored a path stays on this origin and a socket follows the page", async () => {
  const api = await import("./api")
  expect(api.apiUrl("/api/me")).toBe("/api/me")
  expect(api.socketUrl("/api/ws/user")).toBe("ws://localhost:5173/api/ws/user")
})

test("a stored backend is the base for requests, sockets, and file links", async () => {
  store.set("kiko:backend", "https://kiko.sub.workers.dev/")
  const api = await import("./api")
  const { fileUrl, setFileToken } = await import("./file-token")
  setFileToken("tok")
  expect(api.apiUrl("/api/me")).toBe("https://kiko.sub.workers.dev/api/me")
  expect(api.socketUrl("/api/ws/user")).toBe("wss://kiko.sub.workers.dev/api/ws/user")
  expect(fileUrl("/api/files/home/a")).toBe("https://kiko.sub.workers.dev/api/files/home/a?t=tok")
})

test("a request carries the bearer token, and a socket offers it as a subprotocol", async () => {
  const api = await import("./api")
  api.setToken("abc")
  await api.apiFetch("/api/me")
  expect(sent[0]?.headers.get("authorization")).toBe("Bearer abc")
  expect(api.socketProtocols()).toEqual(["kiko", "abc"])
  expect(store.get("kiko:token")).toBe("abc")
})

test("a 401 clears the token and tells the session", async () => {
  const api = await import("./api")
  let told = 0
  api.setUnauthorizedHandler(() => told++)
  api.setToken("abc")
  status = 401
  await api.apiFetch("/api/me")
  expect(api.getToken()).toBeNull()
  expect(store.has("kiko:token")).toBe(false)
  expect(told).toBe(1)
  expect(api.socketProtocols()).toEqual(["kiko"])
})
