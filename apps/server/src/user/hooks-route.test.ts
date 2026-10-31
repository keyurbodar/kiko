import { describe, expect, it } from "vitest"
import { sha256Hex } from "@kiko/durable/hash"
import type { Env } from "../index"
import { hooksRoute } from "./hooks-route"

const BODY = JSON.stringify({ action: "opened", number: 7 })

type Call = { method: string; args: unknown[] }

function env(calls: Call[]): Env {
  return {
    OWNER: {
      idFromName: (name: string) => name,
      get: () => ({
        userCall: async (method: string, args: unknown[]) => {
          calls.push({ method, args })
          return "ran"
        },
      }),
    },
  } as unknown as Env
}

const token = (letter: string) => letter.repeat(48)

const post = (hook: string, headers: Record<string, string> = {}, payload = BODY) =>
  new Request(`https://kiko.test/api/hooks/${hook}`, { method: "POST", body: payload, headers })

async function signed(key: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload))
  return `sha256=${Buffer.from(mac).toString("hex")}`
}

const bodyKey = async (payload: string) => (await sha256Hex(payload)).slice(0, 32)

const unsignedKey = async (payload: string) => new RegExp(`^${await bodyKey(payload)}:\\d+$`)

describe("webhook posts", () => {
  it("ignores a caller's delivery header when the post is unsigned", async () => {
    const calls: Call[] = []
    const hook = token("a")
    const response = await hooksRoute(post(hook, { "x-github-delivery": "claimed-by-caller" }), env(calls))
    expect(response?.status).toBe(202)
    expect(calls[0]?.args[0]).toBe(hook)
    expect(calls[0]?.args[1]).toMatch(await unsignedKey(BODY))
    expect(calls[0]?.args[2]).toBe(BODY)
  })

  it("ignores a delivery header when the signature does not cover the body", async () => {
    const calls: Call[] = []
    const hook = token("b")
    const signature = await signed(hook, "a different body")
    const response = await hooksRoute(
      post(hook, { "x-github-delivery": "claimed-by-caller", "x-hub-signature-256": signature }),
      env(calls),
    )
    expect(response?.status).toBe(202)
    expect(calls[0]?.args[1]).toMatch(await unsignedKey(BODY))
  })

  it("uses the delivery header a signed provider sends", async () => {
    const calls: Call[] = []
    const hook = token("c")
    const signature = await signed(hook, BODY)
    const response = await hooksRoute(
      post(hook, { "x-github-delivery": "delivery-1", "x-hub-signature-256": signature }),
      env(calls),
    )
    expect(response?.status).toBe(202)
    expect(calls[0]?.args).toEqual([hook, "delivery-1", BODY])
  })

  it("refuses more than sixty signed runs an hour for one hook", async () => {
    const calls: Call[] = []
    const hook = token("d")
    const target = env(calls)
    const headers = {
      "x-github-delivery": "delivery-d",
      "x-hub-signature-256": await signed(hook, BODY),
    }
    for (let sent = 0; sent < 60; sent += 1) expect((await hooksRoute(post(hook, headers), target))?.status).toBe(202)
    const refused = await hooksRoute(post(hook, headers), target)
    expect(refused?.status).toBe(429)
    expect(calls).toHaveLength(60)
  })

  it("counts an unsigned post against the hourly budget too", async () => {
    const calls: Call[] = []
    const hook = token("e")
    const target = env(calls)
    const forged = { "x-hub-signature-256": `sha256=${"0".repeat(64)}` }
    for (let sent = 0; sent < 60; sent += 1) expect((await hooksRoute(post(hook, forged), target))?.status).toBe(202)
    const refused = await hooksRoute(
      post(hook, { "x-github-delivery": "delivery-1", "x-hub-signature-256": await signed(hook, BODY) }),
      target,
    )
    expect(refused?.status).toBe(429)
    expect(calls).toHaveLength(60)
  })

  it("counts each hook separately", async () => {
    const calls: Call[] = []
    const target = env(calls)
    const signedPosts = async (hook: string) => {
      const headers = { "x-github-delivery": "delivery-1", "x-hub-signature-256": await signed(hook, BODY) }
      for (let sent = 0; sent < 60; sent += 1) await hooksRoute(post(hook, headers), target)
    }
    await signedPosts(token("1"))
    const other = token("2")
    const headers = { "x-github-delivery": "delivery-1", "x-hub-signature-256": await signed(other, BODY) }
    expect((await hooksRoute(post(other, headers), target))?.status).toBe(202)
  })
})
