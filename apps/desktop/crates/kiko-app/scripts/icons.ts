import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const crate = join(import.meta.dir, "..")
const root = join(crate, "..", "..", "..", "..")
const logo = join(root, "apps", "web-solid", "public", "kiko.svg")
const out = join(crate, "resources")

const TEMPLATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<g transform="translate(60 61) scale(1.04) translate(-60 -54)"><g transform="translate(0 7)">
<g fill="#000" transform="translate(48.5 50.5) rotate(-38)"><path d="M0 0C13-6 13-24 0-33C-13-24-13-6 0 0Z"/></g>
<g fill="#000" transform="translate(68 48.5) rotate(22)"><path d="M0 0C14-7 14-27 0-37C-14-27C-14-7 0 0Z"/></g>
<path d="M31 88C26 88 24 85 24.4 80C26.2 59 40.5 46 60 46C79.5 46 93.8 59 95.6 80C96 85 94 88 89 88Z" fill="none" stroke="#000" stroke-width="7" stroke-linejoin="round"/>
<circle cx="46.4" cy="67" r="4" fill="#000"/><circle cx="70.6" cy="65.6" r="4" fill="#000"/>
</g></g></svg>`

const ICO_SIZES = [16, 32, 48, 64, 128, 256]

async function resvg(): Promise<typeof import("@resvg/resvg-js")> {
  try {
    return await import("@resvg/resvg-js")
  } catch {
    throw new Error("run bun install at the repo root: @resvg/resvg-js renders the logo")
  }
}

async function png(svg: string, width: number): Promise<Buffer> {
  const { Resvg } = await resvg()
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render().asPng()
}

function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = 6 + entries.length
  images.forEach((image, index) => {
    const at = index * 16
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, at)
    entries.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1)
    entries.writeUInt8(0, at + 2)
    entries.writeUInt8(0, at + 3)
    entries.writeUInt16LE(1, at + 4)
    entries.writeUInt16LE(32, at + 6)
    entries.writeUInt32LE(image.data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += image.data.length
  })
  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

await mkdir(out, { recursive: true })
const colour = await readFile(logo, "utf8")

await writeFile(join(out, "tray-template.png"), await png(TEMPLATE, 36))
await writeFile(join(out, "tray.png"), await png(colour, 44))
await writeFile(join(out, "icon-1024.png"), await png(colour, 1024))
await writeFile(
  join(out, "kiko.ico"),
  ico(await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await png(colour, size) })))),
)

console.log(`wrote ${out}`)
