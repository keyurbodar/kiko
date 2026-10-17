import { afterEach, expect, test } from "bun:test"
import { InMemoryCredentialStore } from "@earendil-works/pi-ai"
import type { UserToClient } from "@kiko/protocol"
import { authorizeUrl, parseCallback, REDIRECT_URI } from "../src/user/chatgpt-signin"
import { ProviderLogins, signInFailure } from "../src/user/provider-login"

const STATE = "state-1"
const HOST = "0b9f0a7e-5c1d-4a52-9d57-2f6c3b5f1a11"
const callback = (params: Record<string, string>) => `${REDIRECT_URI}?${new URLSearchParams(params)}`

test("parseCallback takes the code and client id from the pasted address", () => {
  expect(parseCallback(` ${callback({ code: "c1", state: STATE, client_id: "app_1" })} `, STATE)).toEqual({ code: "c1", clientId: "app_1" })
})

test("parseCallback refuses a wrong origin, a missing code, a state mismatch and a missing client id", () => {
  const bad = (text: string) => () => parseCallback(text, STATE)
  expect(bad("not an address")).toThrow("not a web address")
  expect(bad(`https://example.com/auth/callback?code=c&state=${STATE}&client_id=a`)).toThrow("does not start")
  expect(bad(callback({ state: STATE, client_id: "a" }))).toThrow("no authorization code")
  expect(bad(callback({ code: "c", state: "other", client_id: "a" }))).toThrow("another sign-in")
  expect(bad(callback({ code: "c", state: STATE }))).toThrow("no client id")
  expect(bad(callback({ error: "access_denied" }))).toThrow("refused")
})

test("the authorize url carries PKCE S256, state, nonce, resource and the host id", () => {
  const url = new URL(authorizeUrl({ hostId: HOST.toUpperCase(), state: STATE, nonce: "n1", challenge: "ch1" }))
  expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize")
  const q = url.searchParams
  expect(q.get("code_challenge")).toBe("ch1")
  expect(q.get("code_challenge_method")).toBe("S256")
  expect(q.get("state")).toBe(STATE)
  expect(q.get("nonce")).toBe("n1")
  expect(q.get("resource")).toBe("https://api.openai.com/v1")
  expect(q.get("ext_agent_host_id")).toBe(`urn:uuid:${HOST}`)
  expect(q.get("agent_name_hint")).toBe("Kiko")
  expect(q.get("redirect_uri")).toBe(REDIRECT_URI)
})

test("signInFailure gives a fixed sentence and keeps the provider's words as detail", () => {
  expect(signInFailure(new Error("OAuth state mismatch"))).toStartWith("That address does not match this sign-in. Start again and paste the address from the same tab.")
  expect(signInFailure(new Error("device code expired"))).toStartWith("The sign-in code expired.")
  expect(signInFailure(new Error("access_denied"))).toStartWith("The provider did not approve")
  expect(signInFailure(new Error("fetch failed"))).toStartWith("Kiko could not reach the provider.")
  const odd = signInFailure(new Error("boom Bearer abcdefghijklmnop"))
  expect(odd).toStartWith("The sign-in did not finish. Start again. boom")
  expect(odd).not.toContain("abcdefghijklmnop")
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Frame<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

function harness(info: () => { provider: string; kind: "oauth"; last4: string } | null) {
  const store = new InMemoryCredentialStore()
  const frames: UserToClient[] = []
  const logins = new ProviderLogins<string>({ store, deviceId: () => HOST, info, send: (_owner, frame) => void frames.push(frame) })
  async function wait<T extends UserToClient["t"]>(t: T): Promise<Frame<T>> {
    for (let i = 0; i < 200; i++) {
      const found = frames.find((f) => f.t === t)
      if (found) return found as Frame<T>
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`no ${t} frame`)
  }
  return { store, frames, logins, wait }
}

test("the openai flow asks for the pasted address, exchanges the code and stores the credential", async () => {
  let tokenBody = ""
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    tokenBody = String(init?.body)
    return Response.json({ access_token: "at", refresh_token: "rt", id_token: "id", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" })
  }) as typeof fetch
  const h = harness(() => ({ provider: "openai", kind: "oauth", last4: "" }))
  const run = h.logins.start("o", "l1", "openai")
  const notify = await h.wait("login.notify")
  const url = notify.event.type === "auth_url" ? new URL(notify.event.url) : null
  expect(url?.searchParams.get("ext_agent_host_id")).toBe(`urn:uuid:${HOST}`)
  const prompt = await h.wait("login.prompt")
  expect(prompt.prompt.message).toContain("Copy its full address and paste it here")
  h.logins.answer("o", "l1", prompt.promptId, callback({ code: "c1", state: url!.searchParams.get("state")!, client_id: "app_1" }))
  await run
  await h.wait("login.done")
  const body = new URLSearchParams(tokenBody)
  expect(body.get("grant_type")).toBe("authorization_code")
  expect(body.get("client_id")).toBe("app_1")
  expect(body.get("code_verifier")).toBeTruthy()
  expect(await h.store.read("openai")).toMatchObject({ type: "oauth", access: "at", refresh: "rt", clientId: "app_1" })
})

test("a pasted address from another sign-in fails with the fixed sentence and stores nothing", async () => {
  const h = harness(() => null)
  const run = h.logins.start("o", "l1", "openai")
  const prompt = await h.wait("login.prompt")
  h.logins.answer("o", "l1", prompt.promptId, callback({ code: "c1", state: "someone-else", client_id: "app_1" }))
  await run
  const error = await h.wait("login.error")
  expect(error.reason).toBe("failed")
  expect(error.message).toStartWith("That address does not match this sign-in. Start again and paste the address from the same tab.")
  expect(await h.store.read("openai")).toBeUndefined()
})
