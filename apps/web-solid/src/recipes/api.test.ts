import { afterEach, expect, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import { listInstalls, postInstall } from "./api"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const install = { installId: "i1", slug: "morning-briefing", roomId: "r1" as RoomId, agent: "yuki", at: 1 }

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
  const result = await postInstall({ installId: "i1", slug: "morning-briefing", roomId: "r1" as RoomId, agent: "yuki" })
  expect(result).toEqual({ ok: true, install })
  expect(sent).toEqual({ installId: "i1", slug: "morning-briefing", roomId: "r1", agent: "yuki" })
})

test("the list is empty when the request fails, and the installs when it works", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
  expect(await listInstalls()).toEqual([])
  globalThis.fetch = (async () => json({ installs: [install] })) as unknown as typeof fetch
  expect(await listInstalls()).toEqual([install])
})
