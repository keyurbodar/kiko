import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { Apps, type Builder } from "./service"

const SCHEMA = [
  "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  `CREATE TABLE apps (name TEXT PRIMARY KEY, deploy_id TEXT NOT NULL, url TEXT NOT NULL, claimed INTEGER NOT NULL,
    expires_at TEXT, artifact_hash TEXT NOT NULL, kek_version INTEGER NOT NULL, iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL, updated_at INTEGER NOT NULL) WITHOUT ROWID`,
]

function sqlite() {
  const db = new DatabaseSync(":memory:")
  for (const step of SCHEMA) db.exec(step)
  return {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, rowsWritten: 0 }
      }
      return { toArray: () => [], rowsWritten: Number(statement.run(...bindings).changes) }
    },
  } as unknown as SqlStorage
}

const build: Builder = async (files) => ({
  ok: true,
  envelope: {
    artifact: { createdWith: { lakebed: "1.0.0" }, files: Object.keys(files) },
    artifactHash: `hash-${JSON.stringify(files).length}`,
    clientBundle: "",
    clientBundleHash: "",
  },
})

function lakebed() {
  const state = { sessions: 0, claimed: false, deploys: 0 }
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname
    const method = init.method ?? "GET"
    if (method === "POST" && path === "/v1/auth/cli-sessions") {
      state.sessions += 1
      return Response.json({
        sessionId: `s${state.sessions}`,
        pollSecret: "secret",
        code: `CODE-${state.sessions}`,
        verificationUrl: "https://api.lakebed.dev/cli",
        expiresAt: "2099-01-01T00:00:00.000Z",
      })
    }
    if (method === "POST" && path.endsWith("/exchange")) return Response.json({ status: "pending" })
    if (method === "POST" && path === "/v1/anonymous-deploys") {
      state.deploys += 1
      const id = `d${state.deploys}`
      return Response.json({
        deployId: id,
        url: `https://${id}.lakebed.app`,
        claimed: false,
        expiresAt: "2026-11-02T00:00:00.000Z",
        claimUrl: `https://api.lakebed.dev/claim/${id}/token-${id}`,
      })
    }
    if (method === "GET" && path.startsWith("/v1/deploys/")) return Response.json({ claimed: state.claimed })
    return new Response("unexpected", { status: 500 })
  }) as unknown as typeof fetch
  return { state, fetcher }
}

const keyring = { current: { version: 1, secret: "test-kek" } }
const source = (title: string) => ({ "server/index.ts": `export default "${title}"` })

describe("apps ownership", () => {
  it("hands back one claim link per sign-in for every new anonymous app", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)

    const first = await apps.deploy("first-app", source("one"))
    const second = await apps.deploy("second-app", source("two"))

    if (!first.ok || !second.ok) throw new Error("deploy failed")
    expect(first.claim?.url).toBe("https://api.lakebed.dev/claim/d1/token-d1?cli_session=s1")
    expect(second.claim?.url).toBe("https://api.lakebed.dev/claim/d2/token-d2?cli_session=s1")
    expect(second.claim?.code).toBe("CODE-1")
    expect(api.state.sessions).toBe(1)
    expect(await apps.status()).toEqual({ state: "waiting", url: "https://api.lakebed.dev/cli", code: "CODE-1" })
  })

  it("shows an app as owned once the human claims it on Lakebed", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))

    expect((await apps.overview()).apps.map((a) => [a.claimed, a.expiresAt])).toEqual([
      [false, "2026-11-02T00:00:00.000Z"],
    ])
    api.state.claimed = true
    expect((await apps.overview()).apps.map((a) => [a.claimed, a.expiresAt])).toEqual([[true, null]])
  })
})
