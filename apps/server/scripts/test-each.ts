// Runs every server test file in its own `bun test` process. Each file boots its own workerd through
// Miniflare; nineteen of them in one process collided on ports and timed out at random, so a green run
// meant little. One process per file is deterministic. Separate processes did not collide when four ran
// at once (Miniflare picks free ports), so files run in parallel, three at a time by default because
// the machine's CPUs are shared. `--jobs N` overrides that.
// A passing file is cached under node_modules/.cache/kiko-tests. Its key covers the files that file can
// reach, so a change to one module reruns only the tests that load it. A test that reads files through a
// computed path cannot be keyed, so it always runs. `--no-cache` forces a run. Exit code 1 if any file fails.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const serverDir = join(import.meta.dir, "..")
const root = resolve(serverDir, "..", "..")
const dir = join(serverDir, "test")
const cacheDir = join(root, "node_modules", ".cache", "kiko-tests")

const args = process.argv.slice(2)
const noCache = args.includes("--no-cache")
const jobsAt = args.indexOf("--jobs")
const jobs = jobsAt >= 0 ? Math.max(1, Number(args[jobsAt + 1]) || 1) : 3
const only = args.filter((a, i) => !a.startsWith("--") && (jobsAt < 0 || i !== jobsAt + 1))
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (!only.length || only.some((o) => f.includes(o)))).sort()

// Files every test depends on whatever it imports: the lockfile pins npm packages, the package and wrangler
// configs set the test environment, and this runner decides how files run.
const shared = ["bun.lock", "apps/server/package.json", "apps/server/tsconfig.json", "apps/server/wrangler.jsonc", "apps/server/scripts/test-each.ts"]
// A call that reads a file by a path the scan cannot follow. Only a file that imports fs can make one:
// `readdir` is also a method name in the sandbox's BashAPI, and matching that made nearly every test
// uncacheable.
const READS = /readFileSync|readFile\(|readdirSync|\breaddir\(/
const FS_IMPORT = /from\s*["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs/
// A quoted relative path. Miniflare tests name their worker entry this way, and it is not an import.
const RELATIVE = /["'`](\.{1,2}\/[^"'`\s]+)["'`]/g

type Reach = { deps: string[]; reads: boolean }
const reached = new Map<string, Reach>()

// The module's own repo files it names, by import or by a relative path in its source. Bare imports resolve
// to a workspace package's real path. npm packages under node_modules are pinned by bun.lock, so they are skipped.
function inRepo(spec: string, from: string): string | undefined {
  try {
    const path = Bun.resolveSync(spec, from)
    return path.startsWith(root + "/") && !path.includes("/node_modules/") ? path : undefined
  } catch {
    return undefined
  }
}

function reach(file: string): Reach {
  const known = reached.get(file)
  if (known) return known
  const source = readFileSync(file, "utf8")
  const reads = /Bun\.file\(/.test(source) || (FS_IMPORT.test(source) && READS.test(source))
  const entry: Reach = { deps: [], reads }
  reached.set(file, entry)
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) return entry
  const loader = /\.(js|mjs)$/.test(file) ? "js" : "ts"
  const specs = [...new Bun.Transpiler({ loader }).scanImports(source).map((i) => i.path), ...[...source.matchAll(RELATIVE)].map((m) => m[1])]
  for (const spec of specs) {
    const path = inRepo(spec, dirname(file))
    if (path && path !== file) entry.deps.push(path)
  }
  return entry
}

// The key hashes the test file and every repo file it reaches. `cacheable` is false when a reached file reads
// its inputs at run time, because no list of files can then say what the test depends on.
function keyOf(f: string): { key: string; cacheable: boolean } {
  const start = join(dir, f)
  const seen = new Set<string>()
  const queue = [start]
  let cacheable = true
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const info = reach(file)
    if (info.reads) cacheable = false
    queue.push(...info.deps)
  }
  const hash = new Bun.CryptoHasher("sha256")
  for (const path of [...shared.map((p) => join(root, p)), ...seen].sort()) {
    hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0")
  }
  return { key: hash.digest("hex"), cacheable }
}

const cachePath = (f: string) => join(cacheDir, `${f}.json`)
const isCached = (f: string, key: string) => {
  try {
    return JSON.parse(readFileSync(cachePath(f), "utf8")).key === key
  } catch {
    return false
  }
}
const keys = new Map(noCache ? [] : files.map((f) => [f, keyOf(f)]))

type Result = { f: string; code: number; pass: number; fail: number; out: string }

async function runFile(f: string): Promise<Result> {
  // Miniflare leaves a `miniflare-*` directory in the system temp dir for each boot, and it does not
  // remove it on dispose. Pointing TMPDIR at a directory this process owns lets us delete them all
  // when the test process exits. Without it, overnight runs filled a 7.9 GB /tmp with 1,006 dirs.
  const tmp = mkdtempSync(join(tmpdir(), "kiko-tests-"))
  try {
    const proc = Bun.spawn(["bun", "test", "--timeout", "30000", join("test", f)], {
      cwd: serverDir,
      env: { ...process.env, TMPDIR: tmp },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const out = stdout + stderr
    return { f, code, pass: Number(/(\d+) pass/.exec(out)?.[1] ?? 0), fail: Number(/(\d+) fail/.exec(out)?.[1] ?? 0), out }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function pool(list: string[], limit: number, work: (f: string) => Promise<Result>): Promise<Result[]> {
  const queue = [...list]
  const done: Result[] = []
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) done.push(await work(f))
    }),
  )
  return done
}

const cachedFiles = noCache ? [] : files.filter((f) => {
  const { key, cacheable } = keys.get(f) ?? { key: "", cacheable: false }
  return cacheable && isCached(f, key)
})
for (const f of cachedFiles) console.log(`cached ${f}`)
const toRun = files.filter((f) => !cachedFiles.includes(f))

// workerd boots slowly when other processes hold the CPUs, and bun's 5 s test timeout then fails a
// file that passes alone, so tests get 30 s. A failed file also gets one rerun with the machine to
// itself before it counts.
let results = await pool(toRun, jobs, runFile)
const retry = results.filter((r) => r.code !== 0).map((r) => r.f)
if (retry.length && jobs > 1) {
  console.log(`rerunning ${retry.length} failed file${retry.length > 1 ? "s" : ""} one at a time`)
  const again = await pool(retry, 1, runFile)
  results = results.filter((r) => !retry.includes(r.f)).concat(again)
}

let passed = 0
let failed = 0
for (const r of results.sort((a, b) => a.f.localeCompare(b.f))) {
  passed += r.pass
  failed += r.fail + (r.code !== 0 && r.fail === 0 ? 1 : 0)
  console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${r.f}  ${r.pass} pass${r.fail ? `, ${r.fail} fail` : ""}`)
  if (r.code === 0) {
    const { key, cacheable } = keys.get(r.f) ?? { key: "", cacheable: false }
    if (!noCache && cacheable) {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cachePath(r.f), JSON.stringify({ key }))
    }
  } else console.log(r.out.split("\n").filter((l) => /\(fail\)|error:/.test(l)).slice(0, 6).join("\n"))
}
console.log(`\n${passed} pass, ${failed} fail, ${cachedFiles.length} cached across ${files.length} files`)
process.exit(failed ? 1 : 0)
