// Runs every server test file in its own `bun test` process. Each file boots its own workerd through
// Miniflare; nineteen of them in one process collided on ports and timed out at random, so a green run
// meant little. One process per file is deterministic. Separate processes did not collide when four ran
// at once (Miniflare picks free ports), so files run in parallel, three at a time by default because
// the machine's CPUs are shared. `--jobs N` overrides that.
// A passing file is cached under node_modules/.cache/yuki-tests, keyed by a hash of every source file
// the tests can reach. The key is coarse on purpose: any change to the tree reruns every file.
// `--no-cache` forces a run. Exit code 1 if any file fails.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const serverDir = join(import.meta.dir, "..")
const root = resolve(serverDir, "..", "..")
const dir = join(serverDir, "test")
const cacheDir = join(root, "node_modules", ".cache", "yuki-tests")

const args = process.argv.slice(2)
const noCache = args.includes("--no-cache")
const jobsAt = args.indexOf("--jobs")
const jobs = jobsAt >= 0 ? Math.max(1, Number(args[jobsAt + 1]) || 1) : 3
const only = args.filter((a, i) => !a.startsWith("--") && (jobsAt < 0 || i !== jobsAt + 1))
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (!only.length || only.some((o) => f.includes(o)))).sort()

function treeKey(): string {
  const list = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard", "-z", "--", "apps/server", "core", "packages", "bun.lock"], { cwd: root })
  const hash = new Bun.CryptoHasher("sha256")
  for (const path of list.stdout.toString().split("\0").filter(Boolean).sort()) {
    try {
      hash.update(path).update("\0").update(readFileSync(join(root, path))).update("\0")
    } catch {} // listed but deleted in the working tree
  }
  return hash.digest("hex")
}

const key = noCache ? "" : treeKey()
const cachePath = (f: string) => join(cacheDir, `${f}.json`)
const isCached = (f: string) => {
  try {
    return JSON.parse(readFileSync(cachePath(f), "utf8")).key === key
  } catch {
    return false
  }
}

type Result = { f: string; code: number; pass: number; fail: number; out: string }

async function runFile(f: string): Promise<Result> {
  // Miniflare leaves a `miniflare-*` directory in the system temp dir for each boot, and it does not
  // remove it on dispose. Pointing TMPDIR at a directory this process owns lets us delete them all
  // when the test process exits. Without it, overnight runs filled a 7.9 GB /tmp with 1,006 dirs.
  const tmp = mkdtempSync(join(tmpdir(), "yuki-tests-"))
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

const cachedFiles = noCache ? [] : files.filter(isCached)
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
    if (!noCache) {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(cachePath(r.f), JSON.stringify({ key }))
    }
  } else console.log(r.out.split("\n").filter((l) => /\(fail\)|error:/.test(l)).slice(0, 6).join("\n"))
}
console.log(`\n${passed} pass, ${failed} fail, ${cachedFiles.length} cached across ${files.length} files`)
process.exit(failed ? 1 : 0)
