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

await mkdir(out, { recursive: true })
const colour = await readFile(logo, "utf8")

await writeFile(join(out, "tray-template.png"), await png(TEMPLATE, 36))
await writeFile(join(out, "tray.png"), await png(colour, 44))
await writeFile(join(out, "icon-1024.png"), await png(colour, 1024))

console.log(`wrote ${out}`)
