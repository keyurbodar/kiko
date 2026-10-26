import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const HERE = join(import.meta.dir, "..")
const lakebed = realpathSync(join(HERE, "node_modules/lakebed"))
const preact = realpathSync(join(lakebed, "../preact"))
const tailwind = realpathSync(join(HERE, "node_modules/tailwindcss"))

function walk(root: string, dir: string, out: Record<string, string>, prefix: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, path, out, prefix)
    else if (/\.(m?js|json|map)$/.test(entry.name))
      out[`${prefix}/${relative(root, path)}`] = readFileSync(path, "utf8")
  }
}

const files: Record<string, string> = {}
walk(lakebed, join(lakebed, "dist"), files, "lakebed")
walk(preact, preact, files, "preact")

const version = JSON.parse(readFileSync(join(lakebed, "package.json"), "utf8")).version as string
const tailwindCss = readFileSync(join(tailwind, "index.css"), "utf8")
writeFileSync(join(HERE, "src/vendor.json"), JSON.stringify({ version, tailwindCss, files }))
