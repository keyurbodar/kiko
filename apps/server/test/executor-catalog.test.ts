import { expect, test } from "bun:test"
import { compactSignature, DISCOVER_PROGRAM, describeExecute, parseCatalog } from "../src/integrations/executor/catalog"

const GITHUB = 'tools.github.profiles["ins_1"]'

test("an account tool's signature keeps only its input object", () => {
  const sig = '({ accountId: "acc_1", input: { owner: string, page?: number, filter?: { state: "open" | "closed" }, [key: string]: unknown }, [key: string]: unknown }) & { [key: string]: unknown }'
  expect(compactSignature(sig)).toBe('{ owner: string, page?: number, filter?: { state: "open" | "closed" } }')
  expect(compactSignature('({ accountId: "acc_1", input: { [key: string]: unknown }, [key: string]: unknown }) & { [key: string]: unknown }')).toBe("{}")
})

test("a tool without an account keeps its whole argument", () => {
  expect(compactSignature("({ path: { app: string }, body: unknown })")).toBe("({ path: { app: string }, body: unknown })")
})

test("the discovery program carries the compactor it uses", () => {
  expect(DISCOVER_PROGRAM).toContain("function compactSignature")
  expect(() => new Function(`return (async () => { ${DISCOVER_PROGRAM} })`)).not.toThrow()
})

test("a completed discovery becomes a catalog, with unusable apps and their reason", () => {
  const text = JSON.stringify({
    status: "completed",
    execution: { ok: true, value: [{ path: GITHUB, accounts: ["acc_1"], tools: [{ name: "get_me", input: "{}" }, { name: 3 }] }] },
    unavailableApps: [{ app: "app_2", name: "Gmail", reason: JSON.stringify({ code: "AccountRequired", message: "This app needs an account." }) }],
  })
  expect(parseCatalog(text)).toEqual({
    apps: [{ path: GITHUB, accounts: ["acc_1"], tools: [{ name: "get_me", input: "{}" }] }],
    unavailable: [{ name: "Gmail", reason: "This app needs an account." }],
  })
})

test("a failed or paused discovery is no catalog", () => {
  expect(parseCatalog("not json")).toBeNull()
  expect(parseCatalog(JSON.stringify({ status: "completed", execution: { ok: false, error: {} } }))).toBeNull()
  expect(parseCatalog(JSON.stringify({ status: "approval-required", requestId: "apr_1" }))).toBeNull()
})

test("the description gives each app's exact call and steers away from discovery", () => {
  const text = describeExecute({
    apps: [
      { path: GITHUB, accounts: ["acc_1"], tools: [{ name: "list_issues", input: "{ owner: string, repo: string }" }] },
      { path: 'tools.executor.profiles["ins_0"]', accounts: [], tools: [{ name: "accounts.connect" }] },
    ],
    unavailable: [{ name: "Gmail", reason: "needs an account" }],
  })
  expect(text).toContain(`${GITHUB}.<tool>({ accountId: "acc_1", input })`)
  expect(text).toContain("  list_issues { owner: string, repo: string }")
  expect(text).toContain("Gmail: not usable yet (needs an account)")
  expect(text).toContain('tools.executor.profiles["ins_0"].<tool>({ path, query, body }). Tools: accounts.connect.')
  expect(text).toContain("Do not search or read skills for an app listed above")
})
