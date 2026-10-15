import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import { ok } from "../routine-kit"
import type { Suite } from "../runner"

const ROOT = resolve(import.meta.dir, "../../../../..")
const RELEASES = process.env.KIKO_RELEASE_DIR ?? join(ROOT, "dist-release")

type State = Extract<UserToClient, { t: "update.state" }>
type Put = { auth: string; metadata: { keep_bindings?: string[]; bindings: { type: string; name: string }[]; migrations: { old_tag?: string; new_tag: string } }; modules: Map<string, Uint8Array> }

// A local release (built by `bun scripts/release.ts`) behind a static server, and a Cloudflare that records what it is sent.
function fakeCloudflare(refresh: { ok: boolean }) {
  const puts: Put[] = []
  const refreshes: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/oauth2/token") {
        const form = new URLSearchParams(await request.text())
        refreshes.push(`${form.get("grant_type")}:${form.get("client_id")}:${form.get("refresh_token")}`)
        return refresh.ok ? Response.json({ access_token: "new-at", refresh_token: "rotated-rt" }) : new Response("{}", { status: 400 })
      }
      const reply = (result: unknown) => Response.json({ success: true, result })
      if (url.pathname.endsWith("/workers/scripts") && request.method === "GET") return reply([{ id: "other", migration_tag: "v9" }, { id: "kiko", migration_tag: "v1" }])
      if (url.pathname.endsWith("/workers/scripts/kiko") && request.method === "PUT") {
        const form = await request.formData()
        const modules = new Map<string, Uint8Array>()
        for (const [name, value] of form.entries()) if (name !== "metadata" && typeof value !== "string") modules.set(name, new Uint8Array(await (value as File).arrayBuffer()))
        puts.push({ auth: request.headers.get("authorization") ?? "", metadata: JSON.parse(await (form.get("metadata") as File).text()), modules })
        return reply({})
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { server, puts, refreshes }
}

const suite: Suite = {
  name: "update",
  async run(v) {
    if (!existsSync(join(RELEASES, "latest.json"))) {
      const build = Bun.spawnSync(["bun", "scripts/release.ts"], { cwd: ROOT, stdout: "ignore", stderr: "inherit" })
      if (build.exitCode !== 0) throw new VerifyError("bun scripts/release.ts failed. Run it once with a release key (--init-key).")
    }
    const { version } = JSON.parse(readFileSync(join(RELEASES, "latest.json"), "utf8")) as { version: string }
    const manifest = JSON.parse(readFileSync(join(RELEASES, version, "manifest.json"), "utf8")) as { modules: { name: string }[]; migrations: { tag: string }[] }

    const refresh = { ok: true }
    const cloudflare = fakeCloudflare(refresh)
    const statics = Bun.serve({
      port: 0,
      fetch: (request) => {
        const file = Bun.file(join(RELEASES, new URL(request.url).pathname.replace(/^\/releases\//, "")))
        return file.size ? new Response(file) : new Response("not found", { status: 404 })
      },
    })
    try {
      const s = await v.as("update-alice")
      const grant = JSON.stringify({ kind: "oauth", accountId: "acc", scriptName: "kiko", clientId: "cid", refreshToken: "old-rt", accessToken: "old-at" })
      const configure = () =>
        ok(v.url, s, "dev/user/update-config", {
          releaseBase: `http://localhost:${statics.port}/releases`,
          cfApi: `http://localhost:${cloudflare.server.port}/client/v4`,
          oauthUrl: `http://localhost:${cloudflare.server.port}/oauth2/token`,
          grant,
        })
      await configure()
      const user = await s.user()
      const isState = (f: UserToClient): f is State => f.t === "update.state"
      const next = async (): Promise<State> => (await user.expect(isState, 20_000)) as State

      user.send({ t: "update.start", version })
      const stages: string[] = []
      for (;;) {
        const f = await next()
        stages.push(f.stage)
        if (f.stage === "restarting" || f.stage === "failed") {
          if (f.stage === "failed") throw new VerifyError(`update failed: ${f.error}`)
          break
        }
      }
      expectEqual(stages, ["checking", "authorizing", "uploading", "restarting"], "update stages")
      expectEqual(cloudflare.refreshes, [`refresh_token:cid:old-rt`], "the refresh request")
      const put = cloudflare.puts[0]
      if (!put || cloudflare.puts.length !== 1) throw new VerifyError(`expected one upload, saw ${cloudflare.puts.length}`)
      expectEqual(put.auth, "Bearer new-at", "the upload used the refreshed access token")
      expectEqual(put.metadata.keep_bindings, ["secret_text"], "keep_bindings")
      if (put.metadata.bindings.some((b) => b.type === "secret_text")) throw new VerifyError("the upload carried a secret binding")
      expectEqual([put.metadata.migrations.old_tag, put.metadata.migrations.new_tag], ["v1", manifest.migrations.at(-1)?.tag], "migrations start at the current tag")
      for (const m of manifest.modules) {
        const sent = put.modules.get(m.name)
        const built = new Uint8Array(await Bun.file(join(RELEASES, version, m.name)).arrayBuffer())
        if (!sent || Buffer.compare(sent, built) !== 0) throw new VerifyError(`module ${m.name} was not uploaded as the release built it`)
      }

      // The rotated refresh token is the one stored now, not the install's.
      user.send({ t: "update.start", version })
      for (let f = await next(); f.stage !== "restarting"; f = await next()) if (f.stage === "failed") throw new VerifyError(`second update failed: ${f.error}`)
      expectEqual(cloudflare.refreshes.at(-1), "refresh_token:cid:rotated-rt", "the second refresh used the rotated token")

      user.send({ t: "update.start", version: "9.9.9" })
      let f = await next()
      while (f.stage !== "failed") f = await next()
      expectEqual(cloudflare.puts.length, 2, "a wrong version uploads nothing")

      refresh.ok = false
      user.send({ t: "update.start", version })
      f = await next()
      while (f.stage !== "failed") f = await next()
      if (!f.error?.includes("Reconnect Cloudflare")) throw new VerifyError(`a refused grant should say to reconnect, said: ${f.error}`)
      expectEqual(cloudflare.puts.length, 2, "a refused grant uploads nothing")

      user.sendRaw(JSON.stringify({ t: "update.start" }))
      user.sendRaw(JSON.stringify({ t: "update.start", version: "../etc" }))
      await user.expectNone(isState, 500)
    } finally {
      statics.stop(true)
      cloudflare.server.stop(true)
    }
  },
}

export default suite
