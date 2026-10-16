import { afterEach, beforeEach, expect, test } from "bun:test"
import type { RecipeCard, RoomId } from "@kiko/protocol"
import { setToken } from "../lib/api"
import { addToTarget, connectAsk, dismissConnect, installs, isAdded, retryConnect } from "./state"

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
  setToken(null)
  dismissConnect()
  delete (globalThis as { localStorage?: unknown }).localStorage
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const target = { roomId: "r1" as RoomId, agent: "kiko", name: "Kiko" }
const card: RecipeCard = {
  slug: "morning-briefing",
  title: "Morning briefing",
  description: "",
  when: "",
  apps: [{ name: "Gmail", slug: "gmail", connected: null }],
  setup: [],
  agent: { name: "Briefing", handle: "briefing" },
  custom: false,
  tags: [],
  icon: "x",
  glyph: "",
  tone: "blue",
}
const settle = () => new Promise((r) => setTimeout(r, 10))

test("an add that needs an app shows the connect ask, marks nothing added, and does not navigate; the retry reuses the id and adds it", async () => {
  const links = [{ app: "Gmail", url: "https://connect.composio.dev/x" }]
  const sent: { installId: string }[] = []
  let answer: unknown = { state: "needs_connect", links }
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return json(answer)
  }) as unknown as typeof fetch
  const went: string[] = []
  addToTarget(card, target, (to) => went.push(to))
  expect(isAdded(card.slug, target)).toBe(false)
  await settle()
  expect(went).toEqual([])
  expect(isAdded(card.slug, target)).toBe(false)
  expect(installs()).toEqual([])
  expect(connectAsk()?.connect.links).toEqual(links)

  answer = { install: { installId: sent[0]!.installId, slug: card.slug, roomId: "r1", agent: "kiko", at: 1, routines: [] } }
  retryConnect()
  await settle()
  expect(sent.map((s) => s.installId)).toEqual([sent[0]!.installId, sent[0]!.installId])
  expect(connectAsk()).toBeNull()
  expect(isAdded(card.slug, target)).toBe(true)
  expect(went).toEqual(["/chat/r1"])
})

test("a retry that still misses an app shows the ask again with the fresh links", async () => {
  globalThis.fetch = (async () => json({ state: "needs_connect", links: [{ app: "Gmail", url: "https://connect.composio.dev/1" }] })) as unknown as typeof fetch
  addToTarget(card, { ...target, agent: "ada" }, () => {})
  await settle()
  globalThis.fetch = (async () => json({ state: "needs_connect", links: [{ app: "Gmail", url: "https://connect.composio.dev/2" }] })) as unknown as typeof fetch
  retryConnect()
  await settle()
  expect(connectAsk()?.connect.links[0]?.url).toBe("https://connect.composio.dev/2")
  expect(installs().filter((i) => i.agent === "ada")).toEqual([])
})
