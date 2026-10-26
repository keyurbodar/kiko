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
  const state = {
    sessions: 0,
    claimed: false,
    deploys: 0,
    updates: 0,
    sessionExpiresAt: "2099-01-01T00:00:00.000Z",
    pages: [] as number[],
    visits: 0,
  }
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const path = url.pathname
    const method = init.method ?? "GET"
    if (url.hostname.endsWith(".lakebed.app")) {
      state.visits += 1
      return new Response("page", { status: state.pages.shift() ?? 200 })
    }
    if (method === "POST" && path === "/v1/auth/cli-sessions") {
      state.sessions += 1
      return Response.json({
        sessionId: `s${state.sessions}`,
        pollSecret: "secret",
        code: `CODE-${state.sessions}`,
        verificationUrl: "https://api.lakebed.dev/cli",
        expiresAt: state.sessionExpiresAt,
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
    if (method === "PUT" && path.startsWith("/v1/deploys/")) {
      state.updates += 1
      const id = path.split("/").at(-1) ?? ""
      return Response.json({
        deployId: id,
        url: `https://${id}.lakebed.app`,
        claimed: false,
        expiresAt: "2026-11-02T00:00:00.000Z",
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

  it("asks for the claim on an app's first deploy only, without a new sign-in per redeploy", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    const first = await apps.deploy("radar", source("radar"))
    api.state.sessionExpiresAt = "2000-01-01T00:00:00.000Z"

    const second = await apps.deploy("radar", source("radar, now with a map"))

    if (!first.ok || !second.ok) throw new Error("deploy failed")
    expect(first.claim?.url).toBe("https://api.lakebed.dev/claim/d1/token-d1?cli_session=s1")
    expect([second.changed, second.claim, second.app.expiresAt]).toEqual([true, undefined, "2026-11-02T00:00:00.000Z"])
    expect([api.state.updates, api.state.sessions]).toEqual([1, 1])
  })
})

describe("apps liveness after deploy", () => {
  it("reports the page as live once the url answers", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)

    const out = await apps.deploy("radar", source("radar"))

    expect(out.ok && out.live).toBe(200)
    expect(api.state.visits).toBe(1)
  })

  it("looks again once when the url is not up yet, and no more", async () => {
    const api = lakebed()
    api.state.pages = [503, 503, 503]
    const pauses: number[] = []
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher, async (ms) => {
      pauses.push(ms)
    })

    const out = await apps.deploy("radar", source("radar"))

    expect(out.ok && out.live).toBe(503)
    expect([api.state.visits, pauses.length]).toEqual([2, 1])
  })

  it("does not look at the url when the source did not change", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))

    const again = await apps.deploy("radar", source("radar"))

    expect(again.ok && again.changed).toBe(false)
    expect(api.state.visits).toBe(1)
  })
})
