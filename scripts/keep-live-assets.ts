import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ASSET_NAME = /[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|svg|png|webp|wasm)/g

export const assetRefs = (text: string): string[] => [...new Set(text.match(ASSET_NAME) ?? [])]

async function keepLiveAssets(assetsDir: string, origin: string): Promise<void> {
  const page = await fetch(origin, { cache: "no-store" })
  if (!page.ok) return console.log(`No live build at ${origin} (${page.status}), nothing to keep`)
  const queue = assetRefs(await page.text())
  const seen = new Set(queue)
  let kept = 0
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const res = await fetch(`${origin}/assets/${name}`)
    if (!res.ok) continue
    const body = new Uint8Array(await res.arrayBuffer())
    if (/\.(?:js|css)$/.test(name)) {
      for (const ref of assetRefs(new TextDecoder().decode(body))) {
        if (seen.has(ref)) continue
        seen.add(ref)
        queue.push(ref)
      }
    }
    const target = join(assetsDir, name)
    if (existsSync(target)) continue
    writeFileSync(target, body)
    kept++
  }
  console.log(`Kept ${kept} assets from the live build so open tabs can still load them`)
}

if (import.meta.main) {
  const [assetsDir, origin] = process.argv.slice(2)
  if (!assetsDir || !origin) throw new Error("usage: keep-live-assets.ts <assets-dir> <live-origin>")
  await keepLiveAssets(assetsDir, origin)
}
