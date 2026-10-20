import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [store, base, ...versions] = process.argv.slice(2)
if (!store || !base || !versions.length) throw new Error("usage: sync-releases.ts <store> <base-url> <version...>")

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
  let parsed: { version?: string; modules?: { name: string }[] } = {}
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest))
  } catch {
  }
  if (parsed.version !== version) {
    console.log(`Skipped ${version}: not served`)
    continue
  }
  const files: [string, Uint8Array][] = [
    ["manifest.json", manifest],
    ["manifest.sig", await get(`${version}/manifest.sig`)],
  ]
  for (const m of parsed.modules ?? []) files.push([m.name, await get(`${version}/${m.name}`)])
  for (const [name, bytes] of files) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), bytes)
  }
  console.log(`Kept release ${version}`)
}
