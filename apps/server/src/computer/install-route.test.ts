import { describe, expect, it, vi } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Env } from "../index"
import { installPs1, installRoute, installSh } from "./install-route"

const ORIGIN = "https://kiko.example"
const PAIR = `${ORIGIN}/pc#owner.1.code`
const VERSION = "9.9.9"
const APP = process.platform === "darwin" ? "kiko-macos-universal.zip" : `kiko-linux-${arch()}.tar.gz`

const FAKE_CORE = `#!/bin/sh
printf 'core %s\\n' "$*" >> "$KIKO_CALLS"
`

const FAKE_APP = `#!/bin/sh
printf 'kiko\\n' >> "$KIKO_CALLS"
`

const FAKE_SYSTEMCTL = `#!/bin/sh
printf 'systemctl %s\\n' "$*" >> "$KIKO_CALLS"
case "$*" in
  *"is-active"*) [ -f "$KIKO_RUNNING" ] && exit 0; exit 3 ;;
  *"show-environment"*) exit 0 ;;
esac
exit 0
`

function arch(): string {
  return process.arch === "arm64" ? "arm64" : "x64"
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function signed(assets: Record<string, Uint8Array>) {
  const sums = Object.entries(assets).map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
  return { version: VERSION, base: "https://releases.example/v9.9.9", sums: `${sums.join("\n")}\n` }
}

function release(assets: Record<string, Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), "kiko-release-"))
  for (const [name, bytes] of Object.entries(assets)) writeFileSync(join(dir, name), bytes)
  return dir
}

function tarball(): Uint8Array {
  const src = mkdtempSync(join(tmpdir(), "kiko-app-src-"))
  writeFileSync(join(src, "kiko"), FAKE_APP)
  writeFileSync(join(src, "kiko-core"), FAKE_CORE)
  writeFileSync(join(src, "kiko.desktop"), "[Desktop Entry]\nType=Application\nExec=kiko\nIcon=kiko\n")
  writeFileSync(join(src, "kiko.png"), "png")
  for (const name of ["kiko", "kiko-core"]) chmodSync(join(src, name), 0o755)
  const out = join(mkdtempSync(join(tmpdir(), "kiko-app-")), APP)
  const packed = spawnSync("tar", ["-czf", out, "-C", src, "kiko", "kiko-core", "kiko.desktop", "kiko.png"])
  if (packed.status !== 0) throw new Error(String(packed.stderr))
  return new Uint8Array(readFileSync(out))
}

type InstallOptions = {
  args?: string[]
  home?: string
  systemd?: boolean
  running?: boolean
  shell?: string
}

function install(body: string, base: string, options: InstallOptions = {}) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), "kiko-home-"))
  const calls = join(home, "calls")
  const bin = join(home, "path")
  mkdirSync(bin, { recursive: true })
  if (options.systemd) {
    writeFileSync(join(bin, "systemctl"), FAKE_SYSTEMCTL)
    chmodSync(join(bin, "systemctl"), 0o755)
  }
  const run = spawnSync(options.shell ?? "sh", ["-s", "--", ...(options.args ?? [PAIR])], {
    input: body,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      KIKO_PC_BASE: `file://${base}`,
      KIKO_CALLS: calls,
      KIKO_RUNNING: join(home, "running"),
      DISPLAY: ":0",
    },
  })
  return {
    home,
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []),
    file: (path: string) => readFileSync(join(home, path), "utf8"),
    has: (path: string) => existsSync(join(home, path)),
  }
}

async function served(): Promise<string> {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
  const response = await installRoute(new Request(`${ORIGIN}/pc/install.sh`), {} as Env)
  vi.unstubAllGlobals()
  if (!response) throw new Error("install.sh was not served")
  return response.text()
}

describe.skipIf(process.platform !== "linux")("install.sh", () => {
  it("installs the app, pairs its daemon and starts it with numbered steps", () => {
    const assets = { [APP]: tarball() }
    const run = install(installSh(ORIGIN, signed(assets)), release(assets))
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
    expect(run.stdout).toContain(`kiko: [1/4] downloading ${APP} ${VERSION}`)
    expect(run.stdout).toContain("kiko: [4/4] pairing with https://kiko.example")
    expect(run.file(".local/share/kiko/kiko")).toBe(FAKE_APP)
    expect(run.file(".local/share/kiko/kiko-core")).toBe(FAKE_CORE)
    expect(run.file(".local/share/kiko/VERSION")).toBe(`${VERSION}\n`)
    expect(run.file(".local/share/applications/kiko.desktop")).toContain(`Exec="${run.home}/.local/share/kiko/kiko"`)
    expect(run.calls()).toContain(`core pair ${PAIR}`)
  })

  it("registers a systemd user unit that runs the app", () => {
    const assets = { [APP]: tarball() }
    const run = install(installSh(ORIGIN, signed(assets)), release(assets), { systemd: true })
    expect(run.status).toBe(0)
    const unit = run.file(".config/systemd/user/kiko.service")
    expect(unit).toContain(`ExecStart="${run.home}/.local/share/kiko/kiko"`)
    expect(unit).toContain('Environment="DISPLAY=:0"')
    expect(unit).toContain("Restart=always")
    expect(run.calls()).toContain("systemctl --user enable kiko.service")
    expect(run.calls()).toContain("systemctl --user restart kiko.service")
    expect(run.has(".config/autostart/kiko.desktop")).toBe(false)
  })

  it("falls back to an autostart entry when there is no systemd user session", () => {
    const assets = { [APP]: tarball() }
    const run = install(installSh(ORIGIN, signed(assets)), release(assets))
    expect(run.status).toBe(0)
    expect(run.file(".config/autostart/kiko.desktop")).toContain(`Exec="${run.home}/.local/share/kiko/kiko"`)
    expect(run.has(".config/systemd/user/kiko.service")).toBe(false)
  })

  it("replaces an old kiko-computer daemon install and keeps its config dir", () => {
    const assets = { [APP]: tarball() }
    const home = mkdtempSync(join(tmpdir(), "kiko-home-"))
    mkdirSync(join(home, ".kiko-computer", "bin"), { recursive: true })
    writeFileSync(join(home, ".kiko-computer", "bin", "kiko-computer"), "old daemon")
    mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true })
    writeFileSync(join(home, ".config", "systemd", "user", "kiko-computer.service"), "old unit")
    mkdirSync(join(home, ".config", "kiko-computer"), { recursive: true })
    writeFileSync(join(home, ".config", "kiko-computer", "config.json"), "paired")
    const run = install(installSh(ORIGIN, signed(assets)), release(assets), { home, systemd: true })
    expect(run.status).toBe(0)
    expect(run.has(".kiko-computer")).toBe(false)
    expect(run.has(".config/systemd/user/kiko-computer.service")).toBe(false)
    expect(run.calls()).toContain("systemctl --user disable --now kiko-computer.service")
    expect(run.file(".config/kiko-computer/config.json")).toBe("paired")
  })

  it("does nothing on a rerun of the same version", () => {
    const assets = { [APP]: tarball() }
    const body = installSh(ORIGIN, signed(assets))
    const base = release(assets)
    const first = install(body, base, { systemd: true })
    writeFileSync(join(first.home, "running"), "1")
    writeFileSync(join(first.home, "calls"), "")
    const again = install(body, base, { home: first.home, args: [], systemd: true })
    expect(again.status).toBe(0)
    expect(again.stdout).toContain(`kiko: kiko ${VERSION} is already installed`)
    expect(again.calls()).not.toContain("systemctl --user restart kiko.service")
    expect(again.file(".local/share/kiko/kiko")).toBe(FAKE_APP)
  })

  it("pairs again on a rerun under bash, where an unset step count would abort", () => {
    const assets = { [APP]: tarball() }
    const body = installSh(ORIGIN, signed(assets))
    const base = release(assets)
    const first = install(body, base, { systemd: true })
    writeFileSync(join(first.home, "running"), "1")
    writeFileSync(join(first.home, "calls"), "")
    const again = install(body, base, { home: first.home, systemd: true, shell: "bash" })
    expect(again.stderr).toBe("")
    expect(again.status).toBe(0)
    expect(again.stdout).toContain("kiko: [1/1] pairing with https://kiko.example")
    expect(again.calls()).toContain(`core pair ${PAIR}`)
  })

  it("installs nothing when the download does not match its checksum", () => {
    const assets = { [APP]: tarball() }
    const base = release(assets)
    writeFileSync(join(base, APP), "tampered")
    const run = install(installSh(ORIGIN, signed(assets)), base)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("checksum mismatch")
    expect(run.has(".local/share/kiko/kiko")).toBe(false)
    expect(run.calls()).toEqual([])
  })

  it("leaves the installed app in place when an update fails its checksum", () => {
    const assets = { [APP]: tarball() }
    const body = installSh(ORIGIN, signed(assets))
    const first = install(body, release(assets), { systemd: true })
    writeFileSync(join(first.home, ".local/share/kiko/VERSION"), "1.0.0\n")
    writeFileSync(join(first.home, "calls"), "")
    const broken = release(assets)
    writeFileSync(join(broken, APP), "tampered")
    const again = install(body, broken, { home: first.home, args: [], systemd: true })
    expect(again.status).not.toBe(0)
    expect(again.stderr).toContain("checksum mismatch")
    expect(again.file(".local/share/kiko/kiko")).toBe(FAKE_APP)
  })

  it("treats a quote in the request origin as text", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "kiko-marker-")), "pwned")
    const assets = { [APP]: tarball() }
    const run = install(installSh(`https://x'; touch '${marker}'; echo '`, signed(assets)), release(assets), {
      args: [],
    })
    expect(run.status).toBe(0)
    expect(existsSync(marker)).toBe(false)
    expect(run.stdout).toContain("no pair link yet")
  })
})

describe("install.ps1", () => {
  const assets = { "kiko-windows-x64.zip": new Uint8Array([1]) }

  it("escapes a quote in the request origin", () => {
    const body = installPs1(`https://x'; touch /tmp/pwned; echo '`, signed(assets))
    expect(body).toContain(`$origin = 'https://x''; touch /tmp/pwned; echo '''`)
  })

  it("installs the app under LOCALAPPDATA and swaps it through a detached helper", () => {
    const body = installPs1(ORIGIN, signed(assets))
    expect(body).toContain("kiko-windows-x64.zip")
    expect(body).toContain("$root = Join-Path $local 'kiko'")
    expect(body).toContain("Start-Process -FilePath 'powershell' -WindowStyle Hidden")
    expect(body).toContain("Remove-ItemProperty -Path '__RUN__' -Name 'kiko-computer'")
  })
})

describe("install route", () => {
  it("serves a script that refuses to install when no signed release is published", async () => {
    const body = await served()
    const run = install(body, mkdtempSync(join(tmpdir(), "kiko-release-")))
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain("no signed kiko release")
    expect(run.calls()).toEqual([])
  })
})

describe("install script hints", () => {
  const assets = { [APP]: new Uint8Array([1]) }

  it("tells macOS owners to allow accessibility and screen recording for kiko", () => {
    const body = installSh(ORIGIN, signed(assets))
    expect(body).toContain("turn on kiko in both lists")
    expect(body).toContain("Accessibility and Screen Recording")
  })
})
