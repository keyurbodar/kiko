import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Resvg } from "@resvg/resvg-js"

const OUT = ["apps/web-solid/public", "apps/landing/public"]
const INK = "#08131c"

const MARK = `<g transform="translate(0 7)"> <g transform="translate(48.5 50.5) rotate(-38)"> <path data-leaf="back" d="M0 0C13-6 13-24 0-33C-13-24-13-6 0 0Z" fill="#55685A" /> </g> <path d="M31 88C26 88 24 85 24.4 80C26.2 59 40.5 46 60 46C79.5 46 93.8 59 95.6 80C96 85 94 88 89 88Z" fill="#FBF6EC" /> <g transform="translate(68 48.5) rotate(22)"> <g data-leaf="front"> <path d="M0 0C14-7 14-27 0-37C-14-27-14-7 0 0Z" fill="#86A38D" /> <path d="M0-3Q1.6-18 0-32" stroke="#C3D5C6" stroke-width="1.5" fill="none" stroke-linecap="round" /> </g> </g> <ellipse cx="38.5" cy="76.5" rx="5" ry="2.7" fill="#F2A08E" opacity=".6" /> <ellipse cx="81" cy="74.5" rx="4.6" ry="2.5" fill="#F2A08E" opacity=".6" /> <g data-eyes=""> <circle cx="46.4" cy="67" r="3.4" fill="#C22F2A" /> <circle cx="70.6" cy="65.6" r="3.4" fill="#C22F2A" /> <circle cx="45.4" cy="65.9" r="1.15" fill="#FFF" opacity=".9" /> <circle cx="69.6" cy="64.5" r="1.15" fill="#FFF" opacity=".9" /> </g> </g>`
const mascot = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 4 92 100">${MARK}</svg>`

function tile({ rounded, ink }: { rounded: boolean; ink: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120"${rounded ? ' rx="27"' : ""} fill="${ink}"/><g transform="translate(60 61) scale(1.04) translate(-60 -54)">${MARK}</g></svg>`
}

const png = (svg: string, size: number) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()

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

for (const dir of OUT) {
  const ink = dir === "apps/web-solid/public" ? INK : "#0a0a0a"
  const small = tile({ rounded: true, ink })
  const square = tile({ rounded: false, ink })
  const files: Record<string, string | Uint8Array> = {
    "kiko.svg": small,
    "favicon-16x16.png": png(small, 16),
    "favicon-32x32.png": png(small, 32),
    "favicon.ico": ico([16, 32, 48].map((size) => ({ size, data: png(small, size) }))),
    "apple-touch-icon.png": png(square, 180),
    "icon-192.png": png(small, 192),
    "icon-512.png": png(small, 512),
  }
  for (const [name, data] of Object.entries(files)) writeFileSync(resolve(import.meta.dir, "..", dir, name), data)
}

writeFileSync(resolve(import.meta.dir, "../apps/web-solid/public/kiko-mascot.svg"), mascot)
writeFileSync(
  resolve(import.meta.dir, "../apps/web-solid/public/kiko-mascot-blink.svg"),
  mascot.replace('<g data-eyes="">', '<g data-eyes="" transform="translate(0 59.4) scale(1 .1)">'),
)
