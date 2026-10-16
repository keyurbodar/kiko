// Usage: bun issues/bin/keep-release.ts <store> <base-url>
// Copies the release the front door serves now into <store>/<version>/, unless it is there already. A tab that still
// runs that version updates its backend to it, so the next deploy must keep serving it.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [store, base] = process.argv.slice(2)
if (!store || !base) throw new Error("usage: keep-release.ts <store> <base-url>")
const get = async (path: string) => {
  const res = await fetch(`${base}/${path}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
const latest = await fetch(`${base}/latest.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const version = (latest as { version?: string } | null)?.version
if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) process.exit(0)
const dir = join(store, version)
if (existsSync(join(dir, "manifest.sig"))) process.exit(0)
const manifest = await get(`${version}/manifest.json`)
const parsed = JSON.parse(new TextDecoder().decode(manifest)) as { version?: string; modules?: { name: string }[] }
// An unknown path answers with the app page, so only a manifest that names the version is a release.
if (parsed.version !== version) process.exit(0)
const files: [string, Uint8Array][] = [["manifest.json", manifest], ["manifest.sig", await get(`${version}/manifest.sig`)]]
for (const m of parsed.modules ?? []) files.push([m.name, await get(`${version}/${m.name}`)])
for (const [name, bytes] of files) {
  mkdirSync(join(dir, name, ".."), { recursive: true })
  writeFileSync(join(dir, name), bytes)
}
console.log(`Kept release ${version}`)
