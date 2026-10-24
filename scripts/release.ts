import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { extname, join, resolve } from "node:path"
import {
  COMPUTER_ASSETS,
  COMPUTER_REPO,
  COMPUTER_SUMS_FILE,
  computerAssetBase,
  computerSums,
} from "../core/computer/src/install.ts"
import { sha256Hex } from "../core/durable/src/hash.ts"
import {
  type ReleaseComputer,
  type ReleaseManifest,
  verifyModuleHash,
  verifyRelease,
} from "../core/durable/src/release.ts"

const ROOT = resolve(import.meta.dir, "..")
const SERVER = join(ROOT, "apps/server")
const COMPUTER = join(ROOT, "apps/computer")
const OUT = join(ROOT, "dist-release")
const KEY_DIR = join(homedir(), ".config", "kiko")
const KEY_PATH = join(KEY_DIR, "release-key.json")

type Jwk = { kty: string; crv: string; x: string; d?: string }

const MODULE_TYPES: Record<string, string> = {
  ".js": "application/javascript+module",
  ".mjs": "application/javascript+module",
  ".cjs": "application/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".txt": "text/plain",
  ".html": "text/plain",
  ".bin": "application/octet-stream",
}

const SKIPPED = new Set(["README.md"])

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  )
}

async function initKey(): Promise<void> {
  if (await exists(KEY_PATH)) {
    console.log(`${KEY_PATH} already exists. Keeping it.`)
    console.log(`Public key x: ${(await loadKey()).x}`)
    return
  }
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as Jwk
  await mkdir(KEY_DIR, { recursive: true })
  await writeFile(KEY_PATH, `${JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d }, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(KEY_PATH, 0o600)
  console.log(`Wrote ${KEY_PATH} (mode 600).`)
  console.log(`Public key x: ${jwk.x}`)
}

async function loadKey(): Promise<{ privateKey: CryptoKey; x: string }> {
  if (!(await exists(KEY_PATH))) throw new Error(`No release key. Run: bun scripts/release.ts --init-key`)
  const jwk = JSON.parse(await readFile(KEY_PATH, "utf8")) as Jwk
  if (!jwk.d) throw new Error(`${KEY_PATH} has no private part.`)
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"])
  return { privateKey, x: jwk.x }
}

async function dryRun(outdir: string): Promise<void> {
  await rm(outdir, { recursive: true, force: true })
  const proc = Bun.spawn(["bunx", "wrangler", "deploy", "--dry-run", "--outdir", outdir], {
    cwd: SERVER,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) throw new Error("wrangler dry-run failed")
}

async function protocolVersion(): Promise<number> {
  const text = await readFile(join(ROOT, "core/protocol/src/version.ts"), "utf8").catch(() => "")
  const found = text.match(/export const PROTOCOL\s*(?::\s*number)?\s*=\s*(\d+)/)
  return found ? Number(found[1]) : 1
}

async function moduleFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || SKIPPED.has(entry.name) || entry.name.endsWith(".map")) continue
    const full = join(entry.parentPath, entry.name)
    out.push(full.slice(dir.length + 1))
  }
  return out.sort()
}

async function buildComputer(): Promise<{ assets: ReleaseComputer["assets"]; files: Map<string, Uint8Array> }> {
  const pkg = JSON.parse(await readFile(join(COMPUTER, "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  if (!pkg.scripts?.build)
    throw new Error("apps/computer needs a build script that compiles the five daemon binaries into dist")
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: COMPUTER, stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) throw new Error("the computer daemon build failed")
  const files = new Map<string, Uint8Array>()
  const assets: ReleaseComputer["assets"] = []
  for (const name of COMPUTER_ASSETS) {
    const bytes = new Uint8Array(await readFile(join(COMPUTER, "dist", name)))
    files.set(name, bytes)
    assets.push({ name, sha256: await sha256Hex(bytes) })
    if (name.endsWith(".exe")) continue
    const packed = Bun.gzipSync(bytes, { level: 9 })
    files.set(`${name}.gz`, packed)
    assets.push({ name: `${name}.gz`, sha256: await sha256Hex(packed) })
  }
  return { assets, files }
}

function computerRelease(version: string, assets: ReleaseComputer["assets"]): ReleaseComputer {
  const repo = process.env.GITHUB_REPOSITORY ?? COMPUTER_REPO
  return { version, base: process.env.COMPUTER_ASSET_BASE ?? computerAssetBase(repo, version), assets }
}

async function main(): Promise<void> {
  if (process.argv.includes("--init-key")) return initKey()

  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version?: string }
  const version = pkg.version
  if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error("root package.json needs a plain version")

  const { privateKey, x } = await loadKey()
  const staging = join(OUT, ".staging")
  await dryRun(staging)
  const computer = await buildComputer()

  const config = Bun.JSONC.parse(await readFile(join(SERVER, "wrangler.jsonc"), "utf8")) as {
    main: string
    compatibility_date: string
    compatibility_flags: string[]
    migrations: ReleaseManifest["migrations"]
    durable_objects: { bindings: { name: string; class_name: string }[] }
  }
  const mainModule = `${config.main
    .split("/")
    .pop()
    ?.replace(/\.tsx?$/, "")}.js`
  const files = await moduleFiles(staging)
  if (!files.includes(mainModule)) throw new Error(`wrangler wrote no ${mainModule}`)

  const modules: ReleaseManifest["modules"] = []
  const contents = new Map<string, Uint8Array>()
  for (const name of files) {
    const type = MODULE_TYPES[extname(name)]
    if (!type) throw new Error(`No content type for module ${name}`)
    const bytes = new Uint8Array(await readFile(join(staging, name)))
    contents.set(name, bytes)
    modules.push({ name, type, sha256: await sha256Hex(bytes) })
  }

  const manifest: ReleaseManifest & { durable_objects: { name: string; class_name: string }[] } = {
    version,
    protocol: await protocolVersion(),
    main_module: mainModule,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    migrations: config.migrations,
    durable_objects: config.durable_objects.bindings,
    modules,
    computer: computerRelease(version, computer.assets),
  }
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  const signature = Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, manifestBytes)).toString(
    "base64",
  )
  if (!(await verifyRelease(manifestBytes, signature, x)))
    throw new Error("self-check failed: signature does not verify")
  for (const module of modules) {
    if (!(await verifyModuleHash(module, contents.get(module.name) as Uint8Array)))
      throw new Error(`self-check failed: ${module.name}`)
  }

  const dir = join(OUT, version)
  await rm(dir, { recursive: true, force: true })
  for (const [name, bytes] of contents) await Bun.write(join(dir, name), bytes)
  await Bun.write(join(dir, "manifest.json"), manifestBytes)
  await Bun.write(join(dir, "manifest.sig"), `${signature}\n`)
  const computerDir = join(OUT, "computer")
  await rm(computerDir, { recursive: true, force: true })
  for (const [name, bytes] of computer.files) await Bun.write(join(computerDir, name), bytes)
  await Bun.write(join(computerDir, COMPUTER_SUMS_FILE), computerSums(computer.assets))
  await Bun.write(join(OUT, "latest-owner.json"), `${JSON.stringify({ version })}\n`)
  await rm(staging, { recursive: true, force: true })
  console.log(`Built ${dir}`)
  console.log(`Built ${computerDir}`)
  console.log(new TextDecoder().decode(manifestBytes))
}

await main()
