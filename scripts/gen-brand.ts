/*
 * Writes kiko's icon set: kiko.svg, favicon.ico, the 16 and 32 px favicons, apple-touch-icon.png, the
 * 192 and 512 px manifest icons. They go to apps/web-solid/public and apps/landing/public.
 * The art is the real @kiko/avatar (Fubuki with headphones) on the app's own #0a0a0a, with a zinc
 * blueprint grid behind it. The leaves are recolored silver, so the berry eyes are the only color.
 * Edit the look below, then run `bun scripts/gen-brand.ts`.
 */
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { avatar } from "../packages/avatar/src/index"

const OUT = ["apps/web-solid/public", "apps/landing/public"]
const INK = "#0a0a0a"
const LINE = "#f5f5f5"

const SILVER: Record<string, string> = { "#25492e": "#5b5b63", "#578357": "#b4b4bc", "#2f5e3b": "#7a7a83", "#6fa86f": "#e4e4e7" }
const silver = (svg: string) => svg.replace(/#[0-9A-Fa-f]{6}/g, (hex) => SILVER[hex.toLowerCase()] ?? hex)
const mascot = silver(avatar("kiko", { flavour: "fubuki", mood: "happy", facing: "left", charm: "headphones" }))
/** Headphones and closed eyes turn to mush at 16 px. The small sizes get open red eyes and no charm. */
const mascotSmall = silver(avatar("kiko", { flavour: "fubuki", mood: "calm", facing: "left", charm: "none" }))

const ticks = (n: number, step: number) => Array.from({ length: n }, (_, i) => (i + 1) * step)
const grid = ticks(9, 10)
  .flatMap((p) => [`M${p} 0V100`, `M0 ${p}H100`])
  .join("")

/** One tile. `rounded` clips the corners, `fine` draws the grid and rulers, which only read above 48 px. */
function tile({ rounded, fine }: { rounded: boolean; fine: boolean }): string {
  const face = fine
    ? `<path d="${grid}" fill="none" stroke="${LINE}" stroke-width=".25" opacity=".16"/>` +
      `<circle cx="50" cy="60" r="34" fill="none" stroke="${LINE}" stroke-width=".35" stroke-dasharray="1.6 1.4" opacity=".4"/>` +
      `<path d="M50 6V98M4 60H96" stroke="${LINE}" stroke-width=".25" opacity=".2"/>` +
      `<path d="M6 8h4M8 6v4M90 8h4M92 6v4" stroke="${LINE}" stroke-width=".4" opacity=".55"/>` +
      mascot.replace("<svg ", '<svg x="0" y="8" width="100" height="100" ')
    : mascotSmall.replace("<svg ", '<svg x="-8" y="2" width="116" height="116" ')
  const clip = rounded ? '<clipPath id="r"><rect width="100" height="100" rx="22"/></clipPath>' : ""
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${clip}` +
    `<g${rounded ? ' clip-path="url(#r)"' : ""}><rect width="100" height="100" fill="${INK}"/>${face}</g></svg>`
  )
}

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

const small = tile({ rounded: true, fine: false })
const large = tile({ rounded: true, fine: true })
const square = tile({ rounded: false, fine: true })

const files: Record<string, string | Uint8Array> = {
  "kiko.svg": large,
  "favicon-16x16.png": png(small, 16),
  "favicon-32x32.png": png(small, 32),
  "favicon.ico": ico([16, 32, 48].map((size) => ({ size, data: png(small, size) }))),
  "apple-touch-icon.png": png(square, 180),
  "icon-192.png": png(large, 192),
  "icon-512.png": png(large, 512),
}

for (const dir of OUT) for (const [name, data] of Object.entries(files)) writeFileSync(resolve(import.meta.dir, "..", dir, name), data)
console.log(`wrote ${Object.keys(files).length} files to ${OUT.join(" and ")}`)
