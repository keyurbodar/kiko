import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { describe, expect, it, vi } from "vitest"
import { Apps, type Builder } from "./service"

const SCHEMA = [
  "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  `CREATE TABLE apps (name TEXT PRIMARY KEY, deploy_id TEXT NOT NULL, url TEXT NOT NULL, claimed INTEGER NOT NULL,
    expires_at TEXT, artifact_hash TEXT NOT NULL, inspect_public INTEGER NOT NULL DEFAULT 0,
    kek_version INTEGER NOT NULL, iv BLOB NOT NULL,
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
    expiresAt: "2026-11-02T00:00:00.000Z",
    recordStatus: undefined as number | undefined,
    recordExtra: {} as Record<string, unknown>,
    gate: undefined as Promise<void> | undefined,
    requests: [] as string[],
    pages: [] as number[],
    visits: 0,
  }
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    state.requests.push(input)
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
        expiresAt: state.expiresAt,
        claimUrl: `https://api.lakebed.dev/claim/${id}/token-${id}`,
      })
    }
    if (method === "PUT" && path.startsWith("/v1/deploys/")) {
      state.updates += 1
      if (state.gate) await state.gate
      const id = path.split("/").at(-1) ?? ""
      return Response.json({
        deployId: id,
        url: `https://${id}.lakebed.app`,
        claimed: false,
        expiresAt: state.expiresAt,
      })
    }
    if (method === "GET" && path.startsWith("/v1/deploys/")) {
      if (state.recordStatus !== undefined) return new Response("", { status: state.recordStatus })
      return Response.json({ claimed: state.claimed, ...state.recordExtra })
    }
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

describe("apps deploy safety", () => {
  it("refuses an app_call path that would leave the app", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))

    await expect(apps.call("radar", "GET", "https://evil.example/x", undefined)).rejects.toThrow("Use a path")
    await expect(apps.call("radar", "GET", "//evil.example/x", undefined)).rejects.toThrow("Use a path")
    await expect(apps.call("radar", "GET", "/\\evil.example/x", undefined)).rejects.toThrow("Use a path")
    expect(api.state.requests.filter((request) => request.includes("evil.example"))).toEqual([])
  })

  it("gives up on a builder that never answers", async () => {
    vi.useFakeTimers()
    try {
      const api = lakebed()
      const apps = new Apps(sqlite(), keyring, "owner", () => new Promise(() => {}), api.fetcher)

      const out = apps.deploy("radar", source("radar"))
      for (let minute = 0; minute < 10; minute++) await vi.advanceTimersByTimeAsync(60_000)

      expect(await out).toEqual({ ok: false, error: expect.stringContaining("did not answer") })
    } finally {
      vi.useRealTimers()
    }
  })

  it("redeploys an unchanged app when the public inspect policy changes", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))

    const opened = await apps.deploy("radar", source("radar"), { publicInspect: true })
    const again = await apps.deploy("radar", source("radar"), { publicInspect: true })

    expect([opened.ok && opened.changed, again.ok && again.changed]).toEqual([true, false])
    expect(api.state.updates).toBe(1)
  })

  it("does not call an archived or an expired deploy live", async () => {
    for (const recordExtra of [
      { status: "archived" },
      { status: "terminated" },
      { expiresAt: "2000-01-01T00:00:00.000Z" },
    ]) {
      const api = lakebed()
      const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
      await apps.deploy("radar", source("radar"))
      api.state.recordExtra = recordExtra

      const again = await apps.deploy("radar", source("radar"))

      expect([again.ok && again.changed, api.state.deploys]).toEqual([true, 2])
    }
  })

  it("marks an expired app as gone in the list and the overview", async () => {
    const api = lakebed()
    api.state.expiresAt = "2000-01-01T00:00:00.000Z"
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)

    const out = await apps.deploy("radar", source("radar"))

    expect(out.ok && out.app.expired).toBe(true)
    expect(apps.list().map((app) => app.expired)).toEqual([true])
    expect((await apps.overview()).apps.map((app) => app.expired)).toEqual([true])
  })

  it("runs two deploys of one app one after the other", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)

    const [first, second] = await Promise.all([
      apps.deploy("radar", source("radar")),
      apps.deploy("radar", source("radar, now with a map")),
    ])

    expect([first.ok, second.ok]).toEqual([true, true])
    expect([api.state.deploys, api.state.updates]).toEqual([1, 1])
  })

  it("keeps an env change made during a deploy", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))
    let open!: () => void
    api.state.gate = new Promise<void>((resolve) => {
      open = resolve
    })

    const deploying = apps.deploy("radar", source("radar, now with a map"))
    const setting = apps.env("radar", { A: "1" }, [])
    open()
    await Promise.all([deploying, setting])

    expect(await apps.env("radar", {}, [])).toEqual(["A"])
  })

  it("treats a build error that only mentions fetch as a build error, not a claim", async () => {
    const api = lakebed()
    const saying: Builder = async () => ({
      ok: false,
      diagnostics: [{ path: "server/index.ts", message: "Cannot read property 'fetch' of undefined" }],
    })
    const apps = new Apps(sqlite(), keyring, "owner", saying, api.fetcher)

    const out = await apps.deploy("radar", source("radar"))

    expect(out.ok).toBe(false)
    expect("diagnostics" in out && out.diagnostics.map((d) => d.message)).toEqual([
      "Cannot read property 'fetch' of undefined",
    ])
    expect(api.state.deploys).toBe(0)
  })

  it("asks for a claim when the builder reports the claim-only diagnostic", async () => {
    const api = lakebed()
    const saying: Builder = async (files) =>
      files["server/index.ts"]?.includes("capsule")
        ? {
            ok: true,
            envelope: {
              artifact: { createdWith: { lakebed: "1.0.0" } },
              artifactHash: "placeholder",
              clientBundle: "",
              clientBundleHash: "",
            },
          }
        : {
            ok: false,
            diagnostics: [
              {
                path: "server/index.ts",
                message: "Outbound fetch is disabled for anonymous deploys.",
                code: "anonymous_fetch",
              },
            ],
          }
    const apps = new Apps(sqlite(), keyring, "owner", saying, api.fetcher)

    const out = await apps.deploy("radar", source("radar"))

    expect(out.ok).toBe(false)
    expect("error" in out && out.error).toContain("claim link")
    expect(api.state.deploys).toBe(1)
  })

  it("surfaces a Lakebed outage instead of un-owning an app", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))
    api.state.recordStatus = 500

    await expect(apps.overview()).rejects.toThrow("Reading the Lakebed deploy")
  })

  it("keeps a 404 record as gone, not as an error", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))
    api.state.recordStatus = 404

    expect((await apps.overview()).apps.map((app) => app.claimed)).toEqual([false])
  })

  it("leaves an owned app's row alone when its deploy has gone", async () => {
    const api = lakebed()
    const apps = new Apps(sqlite(), keyring, "owner", build, api.fetcher)
    await apps.deploy("radar", source("radar"))
    api.state.claimed = true
    await apps.overview()
    api.state.recordStatus = 404

    const again = await apps.deploy("radar", source("radar, now with a map"))

    expect(again.ok).toBe(false)
    expect(api.state.deploys).toBe(1)
    expect(apps.list().map((app) => app.url)).toEqual(["https://d1.lakebed.app"])
  })
})
