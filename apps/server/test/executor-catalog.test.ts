import { expect, test } from "bun:test"
import { compactSignature, DISCOVER_PROGRAM, describeExecute, type ExecutorCatalog, parseCatalog, withHandles } from "../src/integrations/executor/catalog"

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
    apps: [{ path: GITHUB, handle: "github", accounts: ["acc_1"], tools: [{ name: "get_me", input: "{}" }] }],
    unavailable: [{ name: "Gmail", reason: "This app needs an account." }],
  })
})

test("a failed or paused discovery is no catalog", () => {
  expect(parseCatalog("not json")).toBeNull()
  expect(parseCatalog(JSON.stringify({ status: "completed", execution: { ok: false, error: {} } }))).toBeNull()
  expect(parseCatalog(JSON.stringify({ status: "approval-required", requestId: "apr_1" }))).toBeNull()
})

const CATALOG: ExecutorCatalog = {
  apps: [
    { path: GITHUB, handle: "github", accounts: ["acc_1"], tools: [{ name: "list_issues", input: "{ owner: string, repo: string }" }, { name: "get_me", input: "{}" }] },
    { path: "tools.weather", handle: "weather", accounts: [], tools: [{ name: "today" }] },
    { path: 'tools.executor.profiles["ins_0"]', handle: "executor", accounts: [], tools: [{ name: "accounts.connect" }] },
  ],
  unavailable: [{ name: "Gmail", reason: "needs an account" }],
}

test("apps get handles named after their slug, unique and never a builtin", () => {
  const text = (paths: string[]) => JSON.stringify({ status: "completed", execution: { ok: true, value: paths.map((path) => ({ path, tools: [] })) } })
  const handles = parseCatalog(text(['tools.google-calendar.profiles["a"]', 'tools.github.profiles["a"]', 'tools.github.profiles["b"]', "tools.tools", "tools.9lives"]))!.apps.map((a) => a.handle)
  expect(handles).toEqual(["google_calendar", "github", "github_2", "tools_app", "9lives_app"])
})

test("the description names each app's handle and steers away from discovery", () => {
  const text = describeExecute(CATALOG)
  expect(text).toContain("github: for example await github.list_issues({ ... }).")
  expect(text).toContain("  list_issues { owner: string, repo: string }")
  expect(text).toContain("Gmail: not usable yet (needs an account)")
  expect(text).toContain('tools.executor.profiles["ins_0"].<tool>({ path, query, body }). Tools: accounts.connect.')
  expect(text).toContain("Do not search or read skills for an app listed above")
})

async function run(code: string, tools: unknown): Promise<unknown> {
  return new Function("tools", `return (async () => { ${code} })()`)(tools)
}

test("a handle fills in the account, wraps the fields in input, and parses the result", async () => {
  const seen: unknown[] = []
  const tools = {
    github: { profiles: { ins_1: { list_issues: async (args: unknown) => (seen.push(args), { content: [{ type: "text", text: '[{"number":7}]' }] }) } } },
  }
  const code = withHandles('const issues = await github.list_issues({ owner: "o", repo: "r" });\nreturn issues[0].number;', CATALOG)
  expect(await run(code, tools)).toBe(7)
  expect(seen).toEqual([{ accountId: "acc_1", input: { owner: "o", repo: "r" } }])
  expect(code.split("\n")).toHaveLength(2)
})

test("a tool error from a handle throws with the tool's text", async () => {
  const tools = { github: { profiles: { ins_1: { get_me: async () => ({ isError: true, content: [{ type: "text", text: "bad token" }] }) } } } }
  await expect(run(withHandles("return await github.get_me();", CATALOG), tools)).rejects.toThrow("bad token")
})

test("only the handles a program names are defined, and never one it declares itself", () => {
  expect(withHandles("return 1", CATALOG)).toBe("return 1")
  expect(withHandles("return await weather.today()", CATALOG)).not.toContain("tools.github")
  expect(withHandles("return await tools.github.profiles['ins_1'].get_me({})", CATALOG)).toBe("return await tools.github.profiles['ins_1'].get_me({})")
  const own = 'const github = tools.github.profiles["ins_1"];\nreturn await github.get_me({ accountId: "acc_1", input: {} });'
  expect(withHandles(own, CATALOG)).toBe(own)
})
