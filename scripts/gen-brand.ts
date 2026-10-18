/*
 * Writes kiko's icon set from the brand kit's app tile (brand/logo, copied from the Kiko Marketing repo,
 * where scripts/build-logo.mjs draws it): kiko.svg, favicon.ico, the 16 and 32 px favicons,
 * apple-touch-icon.png, and the 192 and 512 px manifest icons, to apps/web-solid/public and
 * apps/landing/public. It also inlines the tile into the boot screen of apps/web-solid/index.html.
 * Favicons use the flat tile, as the brand asks below 32 px; everything larger uses the soft one.
 * Copy a new tile into brand/logo, then run `bun scripts/gen-brand.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"

const ROOT = resolve(import.meta.dir, "..")
const OUT = ["apps/web-solid/public", "apps/landing/public"]

const soft = readFileSync(resolve(ROOT, "brand/logo/normal/kiko-app-icon-dark.svg"), "utf8")
const flat = readFileSync(resolve(ROOT, "brand/logo/flat/kiko-app-icon-dark.svg"), "utf8")
/** iOS rounds a touch icon itself, so it gets the tile with square corners. */
const square = soft.replaceAll('rx="26.4"', "")

const png = (svg: string, size: number) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()

/** An ICO file that holds PNG images, which every current browser reads. */
function ico(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16
    head[at] = size % 256
    head[at + 1] = size % 256
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((i) => i.data)])
}

const files: Record<string, string | Uint8Array> = {
  "kiko.svg": soft,
  "favicon-16x16.png": png(flat, 16),
  "favicon-32x32.png": png(flat, 32),
  "favicon.ico": ico([
    { size: 16, data: png(flat, 16) },
    { size: 32, data: png(flat, 32) },
    { size: 48, data: png(soft, 48) },
  ]),
  "apple-touch-icon.png": png(square, 180),
  "icon-192.png": png(soft, 192),
  "icon-512.png": png(soft, 512),
}

for (const dir of OUT) for (const [name, data] of Object.entries(files)) writeFileSync(resolve(ROOT, dir, name), data)
console.log(`wrote ${Object.keys(files).length} files to ${OUT.join(" and ")}`)

// The boot screen shows the tile before any script runs. It is decoration there, so it is hidden from assistive tech.
const inline = soft
  .replace(/<title>[^<]*<\/title>/, "")
  .replace(' role="img" aria-label="Kiko"', ' aria-hidden="true"')
  .replace(/>\s+</g, "><")
  .trim()
const html = resolve(ROOT, "apps/web-solid/index.html")
const page = readFileSync(html, "utf8")
const boot = /(<div id="boot">\s*)[\s\S]*?(\s*<\/div>)/
if (!boot.test(page)) throw new Error("no #boot in index.html")
writeFileSync(html, page.replace(boot, (_, open: string, close: string) => `${open}${inline}${close}`))
console.log("inlined the tile into index.html")
