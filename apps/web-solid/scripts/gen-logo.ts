// Writes the kiko bird, in the default plum, to `public/kiko.svg` and into the boot screen
// in `index.html`, so the first paint shows the mascot before any module loads.
// Run: bun scripts/gen-logo.ts

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { logoSvg } from "../src/mascot/logo"

const root = join(import.meta.dir, "..")
const svg = logoSvg()
writeFileSync(join(root, "public/kiko.svg"), svg + "\n")

const htmlPath = join(root, "index.html")
const html = readFileSync(htmlPath, "utf8")
const start = "<!-- boot-logo -->"
const end = "<!-- /boot-logo -->"
const a = html.indexOf(start)
const b = html.indexOf(end)
if (a < 0 || b < 0) throw new Error("index.html has no boot-logo markers")
writeFileSync(htmlPath, html.slice(0, a + start.length) + "\n        " + svg.replace("<svg ", '<svg aria-hidden="true" ') + "\n        " + html.slice(b))
console.log("wrote public/kiko.svg and the boot logo")
