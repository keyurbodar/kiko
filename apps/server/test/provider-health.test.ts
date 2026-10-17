import { expect, test } from "bun:test"
import { InMemoryCredentialStore, type Provider } from "@earendil-works/pi-ai"
import type { ProviderProblem, RunErrorKind } from "@kiko/protocol"
import { classifyAuthFailure, probeVerdict, problemOfRun, runKindFor } from "../src/user/provider-health"
import { resolveTurnContext } from "../src/user/turn-context"

const ctx = { timezone: null, captures: false }

test("a refresh refusal means signed out, and anything the network or the provider's servers did does not", () => {
  const table: [string, "signed_out" | "unreachable" | "fresh"][] = [
    ["OAuth refresh failed for anthropic: OAuth token request failed (400): invalid_grant", "signed_out"],
    ["OAuth refresh failed for openai: OpenAI OAuth token request failed (401): unauthorized", "signed_out"],
    ["OAuth refresh failed for openai: token request failed (403): forbidden", "signed_out"],
    ["OAuth refresh failed for x: refresh token revoked", "signed_out"],
    ["OAuth refresh failed for x: the refresh token has expired", "signed_out"],
    ["OAuth refresh failed for openai: Stored OpenAI OAuth credential does not contain an issued client ID; reconnect ChatGPT", "signed_out"],
    ["OAuth refresh failed for x: fetch failed", "unreachable"],
    ["OAuth refresh failed for x: request timed out", "unreachable"],
    ["OAuth refresh failed for x: token request failed (503): unavailable", "unreachable"],
    ["OAuth refresh failed for x: token request failed (429): slow down", "unreachable"],
    ["OAuth refresh failed for x: token request failed (500): server_error", "unreachable"],
    ["something nobody planned for", "unreachable"],
    ["OAuth refresh returned a token that expires too soon for x", "fresh"],
  ]
  for (const [message, verdict] of table) expect([message, classifyAuthFailure(message)]).toEqual([message, verdict])
})

test("a run failure maps to a provider problem, and a refused sign-in is a sign-in problem, not a bad key", () => {
  const kinds: [RunErrorKind, ProviderProblem | null][] = [
    ["invalid_key", "key_refused"],
    ["signed_out", "signed_out"],
    ["quota", "no_credit"],
    ["rate_limit", null],
    ["overloaded", null],
    ["timeout", null],
    ["network", null],
    ["other", null],
  ]
  for (const [kind, problem] of kinds) expect([kind, problemOfRun(kind)]).toEqual([kind, problem])
  expect(runKindFor("invalid_key", "oauth")).toBe("signed_out")
  expect(runKindFor("invalid_key", "api_key")).toBe("invalid_key")
  expect(runKindFor("quota", "oauth")).toBe("quota")
})

test("a probe clears the problem when the provider answered, sets one on a refusal or an empty balance, and ignores a limit", () => {
  expect(probeVerdict(null, "api_key")).toBeNull()
  expect(probeVerdict("401 Invalid API key", "api_key")).toBe("key_refused")
  expect(probeVerdict("401 Unauthorized", "oauth")).toBe("signed_out")
  expect(probeVerdict("402 insufficient credit balance", "api_key")).toBe("no_credit")
  expect(probeVerdict("429 rate limit", "api_key")).toBe("keep")
  expect(probeVerdict("502 bad gateway", "oauth")).toBe("keep")
})

class Store extends InMemoryCredentialStore {
  problems = new Map<string, ProviderProblem>()
  problem(provider: string) {
    return this.problems.get(provider)
  }
  setProblem(provider: string, problem: ProviderProblem | null) {
    const same = this.problems.get(provider) === (problem ?? undefined)
    if (problem) this.problems.set(provider, problem)
    else this.problems.delete(provider)
    return !same
  }
}

function acme(refresh: () => Promise<never | { type: "oauth"; access: string; refresh: string; expires: number }>): Provider {
  const nothing = (): never => {
    throw new Error("no models")
  }
  return {
    id: "acme",
    name: "Acme",
    auth: {
      oauth: {
        name: "Acme sign-in",
        login: async () => ({ type: "oauth", access: "a", refresh: "r", expires: 0 }),
        refresh,
        toAuth: async (credential) => ({ apiKey: credential.access }),
      },
    },
    getModels: () => [],
    stream: nothing,
    streamSimple: nothing,
  } as unknown as Provider
}

async function expired() {
  const store = new Store()
  await store.modify("acme", async () => ({ type: "oauth", access: "old", refresh: "r", expires: 0 }))
  return store
}

test("a turn whose refresh is refused marks the provider signed out and says why there is no auth", async () => {
  const store = await expired()
  const turn = await resolveTurnContext(store, "acme", ctx, undefined, acme(async () => Promise.reject(new Error("OAuth token request failed (400): invalid_grant"))))
  expect(turn.auth).toBeNull()
  expect(turn.authProblem).toBe("signed_out")
  expect(turn.credential).toBe("oauth")
  expect(store.problem("acme")).toBe("signed_out")
  expect(turn.problem).toBe("signed_out")
})

test("a turn whose refresh could not reach the server leaves the credential alone", async () => {
  for (const failure of ["fetch failed", "token request failed (503): unavailable", "request timed out"]) {
    const store = await expired()
    const turn = await resolveTurnContext(store, "acme", ctx, undefined, acme(async () => Promise.reject(new Error(failure))))
    expect([failure, turn.auth, turn.authProblem]).toEqual([failure, null, "unreachable"])
    expect(store.problem("acme")).toBeUndefined()
    expect(turn.problem).toBeUndefined()
    expect((await store.read("acme"))?.type).toBe("oauth")
  }
})

test("a turn that refreshes well returns auth, the credential kind, and the problem the provider carried in", async () => {
  const store = await expired()
  store.problems.set("acme", "no_credit")
  const turn = await resolveTurnContext(store, "acme", ctx, undefined, acme(async () => ({ type: "oauth", access: "new", refresh: "r", expires: Date.now() + 3_600_000 })))
  expect(turn.auth?.auth.apiKey).toBe("new")
  expect(turn.credential).toBe("oauth")
  expect(turn.authProblem).toBeUndefined()
  expect(turn.problem).toBe("no_credit")
})
