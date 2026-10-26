import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const GENERATORS = ["gen-kiko-docs.ts", "gen-recipes.ts"]

const outputs = Bun.spawnSync(["git", "ls-files", "*.gen.ts"], { cwd: ROOT })
  .stdout.toString()
  .split("\n")
  .filter(Boolean)
const before = new Map(outputs.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]))

for (const script of GENERATORS) {
  const { exitCode } = Bun.spawnSync(["bun", `scripts/${script}`], {
    cwd: join(ROOT, "apps/server"),
    stdout: "inherit",
    stderr: "inherit",
  })
  if (exitCode !== 0) {
    console.error(`${script} failed`)
    process.exit(1)
  }
}

const stale = outputs.filter((file) => readFileSync(join(ROOT, file), "utf8") !== before.get(file))
if (stale.length) {
  console.error(
    `Generated files were stale and are now regenerated. Review and commit them:\n${stale.map((file) => `  ${file}`).join("\n")}`,
  )
  process.exit(1)
}
console.log("generated files ok")
