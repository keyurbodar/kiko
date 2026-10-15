// Builds a signed backend release. Usage:
//   bun scripts/release.ts --init-key            create the signing key once, print its public x
//   bun scripts/release.ts [--version <v>]       build dist-release/<v>/ and dist-release/latest.json
// The private key stays in ~/.config/kiko/release-key.json (mode 600). It is never printed or copied into dist-release.

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { verifyRelease } from "../core/durable/src/release.ts"

const ROOT = resolve(import.meta.dir, "..")
const SERVER = join(ROOT, "apps/server")
const OUT = join(ROOT, "dist-release")
const KEY_PATH = join(homedir(), ".config", "kiko", "release-key.json")
const WRANGLER = join(SERVER, "node_modules/.bin/wrangler")
const MAIN = "index.js"

type Jwk = { kty: string; crv: string; x: string; d?: string }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

async function initKey(): Promise<void> {
  const existing = await readFile(KEY_PATH).then(
    () => true,
    () => false,
  )
  if (existing) throw new Error(`${KEY_PATH} already exists. Refusing to overwrite the release key.`)
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as Jwk
  await mkdir(join(homedir(), ".config", "kiko"), { recursive: true })
  await writeFile(KEY_PATH, `${JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d }, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(KEY_PATH, 0o600)
  console.log(`Wrote ${KEY_PATH} (mode 600).`)
  console.log(`Public key x: ${jwk.x}`)
}

async function loadKey(): Promise<{ privateKey: CryptoKey; x: string }> {
  const jwk = JSON.parse(await readFile(KEY_PATH, "utf8")) as Jwk
  if (!jwk.d) throw new Error(`${KEY_PATH} has no private part.`)
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"])
  return { privateKey, x: jwk.x }
}

async function gitShortSha(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" })
  const out = (await new Response(proc.stdout).text()).trim()
  return (await proc.exited) === 0 && out ? out : "nogit"
}

async function dryRun(outdir: string): Promise<void> {
  await rm(outdir, { recursive: true, force: true })
  const proc = Bun.spawn([WRANGLER, "deploy", "--dry-run", "--outdir", outdir], {
    cwd: SERVER,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) throw new Error("wrangler dry-run failed")
}

// The config is read once so the manifest records what the bundle was built with. The ASSETS binding is
// left out: the backend release serves no static files, and the installer uploads it without assets.
async function serverConfig() {
  const raw = await readFile(join(SERVER, "wrangler.jsonc"), "utf8")
  const config = Bun.JSONC.parse(raw) as {
    compatibility_date: string
    compatibility_flags: string[]
    durable_objects: { bindings: { name: string; class_name: string }[] }
    migrations: { tag: string; new_sqlite_classes?: string[]; deleted_classes?: string[] }[]
    r2_buckets?: { binding: string; bucket_name: string }[]
  }
  return config
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes("--init-key")) return initKey()

  const versionFlag = args.indexOf("--version")
  const version = versionFlag >= 0 ? args[versionFlag + 1] : `${new Date().toISOString().slice(0, 10)}-${await gitShortSha()}`
  if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error("--version needs letters, digits, dot, dash, or underscore")

  const { privateKey, x } = await loadKey()
  const staging = join(OUT, ".staging")
  await dryRun(staging)

  const bundle = new Uint8Array(await readFile(join(staging, MAIN)))
  const config = await serverConfig()
  const manifest = {
    schema: 1,
    version,
    main_module: MAIN,
    modules: [{ name: MAIN, sha256: await sha256Hex(bundle), bytes: bundle.byteLength }],
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    durable_objects: config.durable_objects.bindings,
    migrations: config.migrations,
    r2_buckets: config.r2_buckets ?? [],
  }
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  const signature = toBase64(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, manifestBytes)))

  if (!(await verifyRelease(manifestBytes, signature, x))) throw new Error("self-check failed: signature does not verify")

  const dir = join(OUT, version)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await Bun.write(join(dir, MAIN), bundle)
  await Bun.write(join(dir, "manifest.json"), manifestBytes)
  await Bun.write(join(dir, "manifest.sig"), `${signature}\n`)
  await rm(staging, { recursive: true, force: true })

  const latest = {
    version,
    manifest: `${version}/manifest.json`,
    signature: `${version}/manifest.sig`,
    manifest_sha256: await sha256Hex(manifestBytes),
  }
  await Bun.write(join(OUT, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`)
  console.log(`Built ${dir}`)
  console.log(`Wrote ${join(OUT, "latest.json")}`)
}

await main()
