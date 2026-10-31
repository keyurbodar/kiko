import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import type { Machine } from "../../types"
import { T3_RELEASE_BASE, T3_VERSION, releaseFor } from "./constants"

export interface InstalledT3 {
  readonly bin: string
  readonly version: string
  readonly sha256: string
}

const cacheRoot = (): string => process.env.KIKO_BENCH_CACHE ?? join(homedir(), ".cache", "kiko-bench")

const archKey = (): string => (process.arch === "arm64" ? "arm64" : "x64")

const platformKey = (m: Machine): string => (m.os === "macos" ? "darwin" : m.os)

const sha256File = async (path: string): Promise<string> => {
  const hash = createHash("sha256")
  hash.update(await readFile(path))
  return hash.digest("hex")
}

const run = async (m: Machine, cmd: readonly string[]): Promise<void> => {
  const result = await m.exec(cmd)
  if (result.code !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`)
  }
}

export const installT3 = async (m: Machine, options: { readonly cacheDir?: string } = {}): Promise<InstalledT3> => {
  const platform = platformKey(m)
  const release = releaseFor(platform, archKey())
  if (release === undefined) {
    throw new Error(`t3 ${T3_VERSION} has no release for ${platform}-${archKey()}`)
  }
  const root = join(options.cacheDir ?? cacheRoot(), "t3", T3_VERSION, `${platform}-${archKey()}`)
  const bin = join(root, m.os === "windows" ? "t3.exe" : "t3")
  const marker = join(root, ".install-complete")
  const markerText = await m.readText(marker).catch(() => undefined)
  const installed = await stat(bin).catch(() => undefined)
  if (markerText?.trim() === T3_VERSION && installed?.isFile() === true) {
    return { bin, version: T3_VERSION, sha256: release.sha256 }
  }

  const staging = `${root}.staging-${process.pid}`
  const archive = join(staging, release.asset)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    await run(m, [
      "curl",
      "-fsSL",
      "--retry",
      "3",
      "--retry-delay",
      "2",
      "-o",
      archive,
      `${T3_RELEASE_BASE}/${release.asset}`,
    ])
    const actual = await sha256File(archive)
    if (actual !== release.sha256) {
      throw new Error(`t3 ${T3_VERSION} ${release.asset} sha256 mismatch: expected ${release.sha256}, got ${actual}`)
    }
    await run(m, ["tar", "-xf", archive, "-C", staging, "--strip-components=1"])
    await rm(archive, { force: true })
    await writeFile(join(staging, ".install-complete"), `${T3_VERSION}\n`)
    await rm(root, { recursive: true, force: true })
    await mkdir(join(root, ".."), { recursive: true })
    await rename(staging, root)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  if (m.os !== "windows") await chmod(bin, 0o755)
  return { bin, version: T3_VERSION, sha256: release.sha256 }
}
