import { describe, expect, it, vi } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import type { Env } from "../index"
import { installRoute } from "./install-route"

const ORIGIN = "https://kiko.example"
const PAIR = `${ORIGIN}/pc#owner.1.code`
const ASSET = `kiko-computer-${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`

const FAKE_DAEMON = `#!/bin/sh
printf '%s\\n' "$*" >> "$KIKO_CALLS"
`

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function script(): Promise<string> {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
  const response = await installRoute(new Request(`${ORIGIN}/pc/install.sh`), {} as Env)
  vi.unstubAllGlobals()
  if (!response) throw new Error("install.sh was not served")
  return response.text()
}

function release(assets: Record<string, Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), "kiko-release-"))
  for (const [name, bytes] of Object.entries(assets)) writeFileSync(join(dir, name), bytes)
  const sums = Object.entries(assets).map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
  writeFileSync(join(dir, "SHA256SUMS-computer"), `${sums.join("\n")}\n`)
  return dir
}

function install(body: string, base: string, options: { args?: string[]; computerHome?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "kiko-home-"))
  const calls = join(home, "calls")
  const computerHome = options.computerHome ?? join(home, ".kiko-computer")
  const run = spawnSync("sh", ["-s", "--", ...(options.args ?? [PAIR])], {
    input: body,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: home,
      KIKO_PC_BASE: `file://${base}`,
      KIKO_CALLS: calls,
      KIKO_COMPUTER_HOME: computerHome,
    },
  })
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []),
    daemon: () => readFileSync(join(computerHome, "bin", "kiko-computer"), "utf8"),
  }
}

function installed(daemon: string): string {
  const computerHome = mkdtempSync(join(tmpdir(), "kiko-computer-"))
  mkdirSync(join(computerHome, "bin"))
  writeFileSync(join(computerHome, "bin", "kiko-computer"), daemon)
  return computerHome
}

describe.skipIf(process.platform === "win32")("install.sh", () => {
  it("downloads the gzipped daemon, pairs it and starts the service with numbered steps", async () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const base = release({ [`${ASSET}.gz`]: gzipSync(daemon), [ASSET]: new Uint8Array([0]) })
    const run = install(await script(), base)
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([`pair ${PAIR}`, "service install"])
    expect(run.stdout).toContain("kiko: [1/4] downloading")
    expect(run.stdout).toContain("kiko: [3/4] pairing with https://kiko.example")
    expect(run.stdout).toContain("kiko: [4/4] starting the background service")
  })

  it("falls back to the plain daemon on a release without a gzipped one", async () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const run = install(await script(), release({ [ASSET]: daemon }))
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([`pair ${PAIR}`, "service install"])
  })

  it("installs nothing when the download does not match its checksum", async () => {
    const base = release({ [`${ASSET}.gz`]: gzipSync(new TextEncoder().encode(FAKE_DAEMON)) })
    writeFileSync(join(base, `${ASSET}.gz`), "tampered")
    const run = install(await script(), base)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("checksum mismatch")
  })

  it("updates an installed daemon in place without pairing or touching the service", async () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const computerHome = installed("old daemon")
    const run = install(await script(), release({ [`${ASSET}.gz`]: gzipSync(daemon) }), { args: [], computerHome })
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([])
    expect(run.stdout).toContain("kiko: [2/2] checking the download")
  })

  it("leaves the installed daemon in place when an update fails its checksum", async () => {
    const base = release({ [`${ASSET}.gz`]: gzipSync(new TextEncoder().encode(FAKE_DAEMON)) })
    writeFileSync(join(base, `${ASSET}.gz`), "tampered")
    const computerHome = installed("old daemon")
    const run = install(await script(), base, { args: [], computerHome })
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("checksum mismatch")
    expect(run.daemon()).toBe("old daemon")
  })
})
