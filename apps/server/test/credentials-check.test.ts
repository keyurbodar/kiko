import { expect, test } from "bun:test"
import { userModels } from "../src/agent/factory"
import { keyRefused } from "../src/user/credentials-check"

const PROVIDER = "opencode-go"

async function refused(answer: () => Response | Promise<Response>): Promise<{ refused: boolean; calls: number }> {
  let calls = 0
  const egress = (async () => {
    calls++
    return answer()
  }) as unknown as typeof fetch
  const { models } = userModels(async () => ({ auth: { apiKey: "sk-test-not-real" } }), "check-test", egress)
  return { refused: await keyRefused(models, PROVIDER), calls }
}

test("a provider that answers 401 or 403 refuses the key", async () => {
  const bad = await refused(() => Response.json({ error: { message: "Invalid API key" } }, { status: 401 }))
  expect(bad.calls).toBeGreaterThan(0)
  expect(bad.refused).toBe(true)
  expect((await refused(() => Response.json({ error: { message: "forbidden" } }, { status: 403 }))).refused).toBe(true)
})

test("a limit, an outage, or a dead network does not prove the key bad", async () => {
  expect((await refused(() => Response.json({ error: { message: "slow down" } }, { status: 429 }))).refused).toBe(false)
  expect((await refused(() => Response.json({ error: { message: "bad gateway" } }, { status: 502 }))).refused).toBe(false)
  expect((await refused(() => Promise.reject(new TypeError("fetch failed")))).refused).toBe(false)
})

test("a provider with no chat models is not checked", async () => {
  const { models } = userModels(async () => ({ auth: { apiKey: "sk-test-not-real" } }), "check-test", (() => Promise.reject(new Error("401"))) as unknown as typeof fetch)
  expect(await keyRefused(models, "acme-test")).toBe(false)
})
