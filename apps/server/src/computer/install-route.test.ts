import { describe, expect, it, vi } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import type { Env } from "../index"
import { installPs1, installRoute, installSh } from "./install-route"

const ORIGIN = "https://kiko.example"
const PAIR = `${ORIGIN}/pc#owner.1.code`
const ASSET = `kiko-computer-${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`

const FAKE_DAEMON = `#!/bin/sh
printf '%s\\n' "$*" >> "$KIKO_CALLS"
`

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function signed(assets: Record<string, Uint8Array>) {
  const sums = Object.entries(assets).map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
  return { version: "9.9.9", base: "https://releases.example/v9.9.9", sums: `${sums.join("\n")}\n` }
}

function release(assets: Record<string, Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), "kiko-release-"))
  for (const [name, bytes] of Object.entries(assets)) writeFileSync(join(dir, name), bytes)
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

async function served(): Promise<string> {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
  const response = await installRoute(new Request(`${ORIGIN}/pc/install.sh`), {} as Env)
  vi.unstubAllGlobals()
  if (!response) throw new Error("install.sh was not served")
  return response.text()
}

describe.skipIf(process.platform === "win32")("install.sh", () => {
  it("downloads the gzipped daemon, pairs it and starts the service with numbered steps", () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const asset = { [`${ASSET}.gz`]: gzipSync(daemon), [ASSET]: new Uint8Array([0]) }
    const run = install(installSh(ORIGIN, signed(asset)), release(asset))
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([`pair ${PAIR}`, "service install"])
    expect(run.stdout).toContain("kiko: [1/4] downloading")
    expect(run.stdout).toContain("kiko: [3/4] pairing with https://kiko.example")
    expect(run.stdout).toContain("kiko: [4/4] starting the background service")
  })

  it("falls back to the plain daemon on a release without a gzipped one", () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const asset = { [ASSET]: daemon }
    const run = install(installSh(ORIGIN, signed(asset)), release(asset))
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([`pair ${PAIR}`, "service install"])
  })

  it("installs nothing when the download does not match its checksum", () => {
    const asset = { [`${ASSET}.gz`]: gzipSync(new TextEncoder().encode(FAKE_DAEMON)) }
    const base = release(asset)
    writeFileSync(join(base, `${ASSET}.gz`), "tampered")
    const run = install(installSh(ORIGIN, signed(asset)), base)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("checksum mismatch")
  })

  it("updates an installed daemon in place without pairing or touching the service", () => {
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const asset = { [`${ASSET}.gz`]: gzipSync(daemon) }
    const computerHome = installed("old daemon")
    const run = install(installSh(ORIGIN, signed(asset)), release(asset), { args: [], computerHome })
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.daemon()).toBe(FAKE_DAEMON)
    expect(run.calls()).toEqual([])
    expect(run.stdout).toContain("kiko: [2/2] checking the download")
  })

  it("leaves the installed daemon in place when an update fails its checksum", () => {
    const asset = { [`${ASSET}.gz`]: gzipSync(new TextEncoder().encode(FAKE_DAEMON)) }
    const base = release(asset)
    writeFileSync(join(base, `${ASSET}.gz`), "tampered")
    const computerHome = installed("old daemon")
    const run = install(installSh(ORIGIN, signed(asset)), base, { args: [], computerHome })
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("checksum mismatch")
    expect(run.daemon()).toBe("old daemon")
  })

  it("treats a quote in the request origin as text", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "kiko-marker-")), "pwned")
    const daemon = new TextEncoder().encode(FAKE_DAEMON)
    const asset = { [`${ASSET}.gz`]: gzipSync(daemon) }
    const run = install(installSh(`https://x'; touch '${marker}'; echo '`, signed(asset)), release(asset), {
      args: [],
    })
    expect(run.status).toBe(0)
    expect(existsSync(marker)).toBe(false)
    expect(run.stdout).toContain("no pair link yet")
  })
})

describe("install.ps1", () => {
  it("escapes a quote in the request origin", () => {
    const body = installPs1(`https://x'; touch /tmp/pwned; echo '`, signed({ [ASSET]: new Uint8Array([1]) }))
    expect(body).toContain(`$origin = 'https://x''; touch /tmp/pwned; echo '''`)
  })
})

describe("install route", () => {
  it("serves a script that refuses to install when no signed release is published", async () => {
    const body = await served()
    const run = install(body, mkdtempSync(join(tmpdir(), "kiko-release-")))
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("no signed kiko-computer release")
    expect(run.calls()).toEqual([])
  })

  it("loads the release once for repeated requests", async () => {
    vi.resetModules()
    const { installRoute: fresh } = await import("./install-route")
    const calls: string[] = []
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      calls.push(String(input))
      return Promise.resolve(new Response("", { status: 404 }))
    })
    await fresh(new Request(`${ORIGIN}/pc/install.sh`), {} as Env)
    await fresh(new Request(`${ORIGIN}/pc/install.sh`), {} as Env)
    vi.unstubAllGlobals()
    expect(calls).toHaveLength(2)
  })
})

describe("install script hints", () => {
  const assets = { [ASSET]: new Uint8Array([1]) }

  it("tells macOS owners to allow screen recording and accessibility", () => {
    const body = installSh(ORIGIN, signed(assets))
    expect(body).toContain("kiko-computer-host")
    expect(body).toContain("Screen Recording, Accessibility")
  })
})
