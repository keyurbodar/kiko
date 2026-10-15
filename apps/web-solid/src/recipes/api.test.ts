import { afterEach, beforeEach, expect, test } from "bun:test"
import type { RecipeCard, RoomId } from "@kiko/protocol"
import { RECIPES } from "./catalog.gen"
import { fetchListing, loadCards, loadListing, postInstall, deleteInstall } from "./api"

const realFetch = globalThis.fetch
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as { localStorage?: unknown }).localStorage
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const install = { installId: "i1", slug: "morning-briefing", roomId: "r1" as RoomId, agent: "kiko", at: 1, routines: [] }
const serverCard: RecipeCard = { slug: "server-only", title: "Server only", description: "", when: "", apps: [], setup: [], agent: { name: "Ada", handle: "ada" }, custom: false, tags: [], icon: "x", glyph: "", tone: "blue" }

test("a 4xx answer with an error becomes that error, and a network failure says Kiko did not answer", async () => {
  globalThis.fetch = (async () => json({ error: "No such recipe." }, 400)) as unknown as typeof fetch
  expect(await postInstall({ installId: "i1", slug: "nope", own: true })).toEqual({ ok: false, error: "No such recipe." })

  globalThis.fetch = (async () => {
    throw new TypeError("offline")
  }) as unknown as typeof fetch
  expect(await postInstall({ installId: "i1", slug: "nope", own: true })).toEqual({ ok: false, error: "Kiko did not answer." })
})

test("a 404 with no JSON body is a failure with a plain message, not a crash", async () => {
  globalThis.fetch = (async () => new Response("<html>", { status: 404 })) as unknown as typeof fetch
  expect(await postInstall({ installId: "i1", slug: "x", own: true })).toEqual({ ok: false, error: "Could not add that recipe." })
})

test("a success returns the install, and the POST carries the install id and the target", async () => {
  let sent: unknown
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return json({ install })
  }) as unknown as typeof fetch
  const result = await postInstall({ installId: "i1", slug: "morning-briefing", roomId: "r1" as RoomId, agent: "kiko" })
  expect(result).toEqual({ ok: true, install })
  expect(sent).toEqual({ installId: "i1", slug: "morning-briefing", roomId: "r1", agent: "kiko" })
})

test("the server's cards win once it sends them, and the list is cached for the next paint", async () => {
  globalThis.fetch = (async () => json({ cards: [serverCard], installs: [install], broken: ["recipe x: description is required"] })) as unknown as typeof fetch
  const next = await fetchListing()
  expect(next).toEqual({ cards: [serverCard], installs: [install], broken: ["recipe x: description is required"] })
  expect(loadCards()).toEqual([serverCard])
  expect(loadListing()).toEqual({ cards: [serverCard], installs: [install], broken: ["recipe x: description is required"] })
})

test("with no cards in the answer the build's catalog shows, and the catalog is not cached", async () => {
  globalThis.fetch = (async () => json({ installs: [install] })) as unknown as typeof fetch
  expect(await fetchListing()).toEqual({ cards: undefined, installs: [install], broken: [] })
  expect(loadCards()).toBe(RECIPES)
  expect(store.get("kiko:recipes:v2")).toBe(JSON.stringify({ installs: [install], broken: [] }))
})

test("a failed request keeps the cached list, and a corrupt cache reads as none installed", async () => {
  globalThis.fetch = (async () => json({ cards: [serverCard], installs: [install] })) as unknown as typeof fetch
  await fetchListing()
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
  expect(await fetchListing()).toBeNull()
  expect(loadCards()).toEqual([serverCard])

  store.set("kiko:recipes:v2", "{not json")
  expect(loadListing()).toEqual({ installs: [] })
  expect(loadCards()).toBe(RECIPES)
})


test("removal is scoped to one install and an already removed install succeeds", async () => {
  let request: unknown
  globalThis.fetch = (async (url: string, init?: RequestInit) => { request = [url, init?.method]; return json({}, 404) }) as unknown as typeof fetch
  expect(await deleteInstall("one-install")).toEqual({ ok: true })
  expect(request).toEqual(["/api/recipes/one-install", "DELETE"])
  globalThis.fetch = (async () => { throw new TypeError("offline") }) as unknown as typeof fetch
  expect((await deleteInstall("one-install")).ok).toBe(false)
})
