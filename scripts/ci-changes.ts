import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"

export type WorkspacePackage = {
  readonly name: string
  readonly dir: string
  readonly deps: readonly string[]
  readonly hasTest: boolean
  readonly hasTypecheck: boolean
}

export type Outputs = {
  readonly typecheck: boolean
  readonly build: boolean
  readonly test: boolean
  readonly test_packages: string
  readonly test_web: boolean
  readonly worker: boolean
}

const ROOT = join(import.meta.dirname, "..")

const INERT = [/^[^/]+\.md$/, /^LICENSE$/, /^\.(claude|vscode|cursor)\//, /^\.github\/dependabot\.yml$/]

const LINT_ONLY = [/^\.oxlintrc\.json$/, /^\.oxfmtrc\.jsonc?$/, /^biome\.json$/, /^knip\.json$/]

const EXTRA_OWNERS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/^scripts\/(check-imports|check-generated)\.ts$/, []],
  [/^scripts\/(release|sync-releases)\.ts$/, ["@kiko/server"]],
  [/^scripts\/gen-(brand|icons)\.ts$/, ["web-solid", "@kiko/ui", "@kiko/landing"]],
]

const WEB = "web-solid"
const WORKER = "@kiko/server"
const BUNDLED = new Set([WEB, WORKER, "@kiko/installer", "@kiko/builder", "@kiko/computer-daemon"])
const OWN_TEST_JOB = new Set([WEB])

export function readWorkspace(root = ROOT): WorkspacePackage[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces: string[] }
  const dirs = manifest.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern]
    const parent = pattern.slice(0, -2)
    return readdirSync(join(root, parent)).map((name) => `${parent}/${name}`)
  })
  return dirs.flatMap((dir) => {
    const path = join(root, dir, "package.json")
    if (!existsSync(path)) return []
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
    return [
      {
        name: pkg.name,
        dir,
        hasTest: Boolean(pkg.scripts?.test),
        hasTypecheck: Boolean(pkg.scripts?.typecheck),
        deps: Object.keys(deps).filter((dep) => String(deps[dep]).startsWith("workspace:")),
      },
    ]
  })
}

function ownersOf(file: string, packages: readonly WorkspacePackage[]): readonly string[] | null {
  if (INERT.some((pattern) => pattern.test(file)) || LINT_ONLY.some((pattern) => pattern.test(file))) return []
  if (basename(file) === "package.json") return null
  const extra = EXTRA_OWNERS.find(([pattern]) => pattern.test(file))
  if (extra) return extra[1]
  const owner = packages.filter((pkg) => file.startsWith(`${pkg.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0]
  return owner ? [owner.name] : null
}

function withDependents(affected: Set<string>, packages: readonly WorkspacePackage[]): void {
  let grew = true
  while (grew) {
    grew = false
    for (const pkg of packages) {
      if (!affected.has(pkg.name) && pkg.deps.some((dep) => affected.has(dep))) {
        affected.add(pkg.name)
        grew = true
      }
    }
  }
}

export function decide(
  files: readonly string[] | null,
  packages: readonly WorkspacePackage[],
  full: boolean,
): { affected: string[]; outputs: Outputs } {
  let everything = full || files === null
  const affected = new Set<string>()
  for (const file of files ?? []) {
    const owners = ownersOf(file, packages)
    if (owners === null) {
      everything = true
      console.error(`Runs everything: ${file}`)
    } else {
      for (const owner of owners) affected.add(owner)
    }
  }
  if (everything) for (const pkg of packages) affected.add(pkg.name)
  else withDependents(affected, packages)

  const tested = packages.filter((pkg) => pkg.hasTest && !OWN_TEST_JOB.has(pkg.name) && affected.has(pkg.name))
  return {
    affected: [...affected].sort(),
    outputs: {
      typecheck: affected.size > 0,
      build: [...BUNDLED].some((name) => affected.has(name)),
      test: tested.length > 0,
      test_packages: tested.map((pkg) => pkg.name).join(" "),
      test_web: affected.has(WEB),
      worker: affected.has(WORKER),
    },
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const pathsIndex = args.indexOf("--paths")
  const pathsFile = pathsIndex === -1 ? undefined : args[pathsIndex + 1]
  const files = pathsFile ? readFileSync(pathsFile, "utf8").split("\n").filter(Boolean) : null
  const { affected, outputs } = decide(files, readWorkspace(), args.includes("--full"))
  console.error(`Affected packages: ${affected.join(", ") || "none"}`)
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`)
}

if (import.meta.main) main()
