import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { releaseConfig } from "../apps/server/src/lib/release-config.ts"
import { type ReleaseModule, verifyModuleHash, verifyRelease } from "../core/durable/src/release.ts"

const [store, base, ...versions] = process.argv.slice(2)
if (!store || !base || !versions.length) throw new Error("usage: sync-releases.ts <store> <base-url> <version...>")

const MODULE_NAME = /^[A-Za-z0-9._-]+$/u
const isModuleName = (name: unknown): name is string =>
  typeof name === "string" && MODULE_NAME.test(name) && !name.includes("..")

const publicKey = releaseConfig({}).publicKey

const get = async (path: string) => {
  const res = await fetch(`${base}/${path}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const seen = new Set<string>()
for (const version of versions) {
  if (!/^[A-Za-z0-9._-]+$/.test(version) || seen.has(version)) continue
  seen.add(version)
  const dir = join(store, version)
  if (existsSync(join(dir, "manifest.sig"))) {
    console.log(`Kept release ${version}`)
    continue
  }
  const manifest = await get(`${version}/manifest.json`)
  let parsed: { version?: string; modules?: ReleaseModule[]; builder?: { modules?: ReleaseModule[] } } = {}
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest))
  } catch {}
  if (parsed.version !== version) {
    console.log(`Skipped ${version}: not served`)
    continue
  }
  const signatureBytes = await get(`${version}/manifest.sig`)
  if (!(await verifyRelease(manifest, new TextDecoder().decode(signatureBytes), publicKey))) {
    throw new Error(`${version}: manifest signature does not verify`)
  }
  const modules = parsed.modules ?? []
  const builderModules = parsed.builder?.modules ?? []
  for (const m of [...modules, ...builderModules]) {
    if (!isModuleName(m.name)) throw new Error(`${version}: unsafe module name ${JSON.stringify(m.name)}`)
  }
  const files: [string, Uint8Array][] = [
    ["manifest.json", manifest],
    ["manifest.sig", signatureBytes],
  ]
  const verified = async (m: ReleaseModule, url: string, name: string): Promise<[string, Uint8Array]> => {
    const bytes = await get(url)
    if (!(await verifyModuleHash(m, bytes))) throw new Error(`${version}: ${name} does not match the signed manifest`)
    return [name, bytes]
  }
  for (const m of modules) files.push(await verified(m, `${version}/${m.name}`, m.name))
  for (const m of builderModules) files.push(await verified(m, `${version}/builder/${m.name}`, `builder/${m.name}`))
  for (const [name, bytes] of files) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), bytes)
  }
  console.log(`Kept release ${version}`)
}
