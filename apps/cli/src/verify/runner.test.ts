import { expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSuites } from "./runner"

async function suitesDir() {
  const dir = await mkdtemp(join(tmpdir(), "kiko-suites-"))
  const client = join(import.meta.dir, "client")
  await writeFile(join(dir, "ok.ts"), `export default { name: "ok", async run() {} }\n`)
  await writeFile(
    join(dir, "model.ts"),
    `export default { name: "model", model: true, async run() { throw new Error("must not run") } }\n`,
  )
  await writeFile(
    join(dir, "wrong.ts"),
    `import { expectEqual } from ${JSON.stringify(client)}\nexport default { name: "wrong", async run() { expectEqual({ n: 2 }, { n: 1 }, "count") } }\n`,
  )
  return dir
}

test("runs suites, skips model suites with noModel, and prints a diff for a wrong expectation", async () => {
  const dir = await suitesDir()
  const lines: string[] = []
  const failed = await runSuites({ url: "http://localhost:1", noModel: true, names: [], dir, log: (l) => lines.push(l) })
  const out = lines.join("\n")
  expect(failed).toEqual(["wrong"])
  expect(out).toContain("pass ok")
  expect(out).toContain("skip model")
  expect(out).toContain("- expected, + actual")
  expect(out).toContain('-   "n": 1')
  expect(out).toContain('+   "n": 2')
})

test("an unknown suite name is an error", async () => {
  const dir = await suitesDir()
  await expect(runSuites({ url: "http://localhost:1", noModel: false, names: ["nope"], dir })).rejects.toThrow(
    "no suite named nope",
  )
})

test("a load test never runs against a deployed server, even by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiko-suites-"))
  await writeFile(join(dir, "load.ts"), `export default { name: "load", load: true, async run() { throw new Error("ran against a deployed server") } }\n`)
  const lines: string[] = []
  const failed = await runSuites({ url: "https://kiko.example.workers.dev", noModel: false, names: ["load"], dir, log: (l) => lines.push(l) })
  expect(failed).toEqual([])
  expect(lines.join("\n")).toContain("skip load (a load test")
})

test("shards cover every suite exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiko-suites-"))
  const names = ["routine-triggers", "routines-scale", "run-error-once", "team-loops", "workers", "latency", "mid-run", "routines", "chats"]
  for (const name of names) await writeFile(join(dir, `${name}.ts`), `export default { name: ${JSON.stringify(name)}, async run() {} }\n`)
  const { loadSuites, shardOf } = await import("./runner")
  const all = await loadSuites(dir)

  for (const shards of [2, 3, 4]) {
    const seen = new Map<string, number>()
    for (let shard = 1; shard <= shards; shard++) {
      for (const s of shardOf(all, shard, shards)) {
        expect(seen.has(s.name)).toBe(false)
        seen.set(s.name, shard)
      }
    }
    expect([...seen.keys()].sort()).toEqual([...names].sort())
  }
})

test("the real suite list is split by weight, not by position", async () => {
  // This runs against the real suite directory, which is where the imbalance shows: splitting the 43 suites
  // by position leaves a 4-way max of 288 s against an even 211 s, and weighting brings it to 211 s.
  const { loadSuites, shardOf } = await import("./runner")
  const { SUITE_SECONDS } = await import("./weights")
  const all = (await loadSuites()).filter((s) => !s.model && !s.human && !s.load)
  expect(all.length).toBeGreaterThan(20)
  const weight = (s: { name: string }) => SUITE_SECONDS[s.name] ?? 0
  const total = all.reduce((sum, s) => sum + weight(s), 0)
  const even = total / 4

  const loads = [1, 2, 3, 4].map((shard) => shardOf(all, shard, 4).reduce((sum, s) => sum + weight(s), 0))
  // Every shard within 15 percent of an even split. Positional splitting is 36 percent over.
  for (const load of loads) expect(load).toBeLessThanOrEqual(even * 1.15)
  // And nothing is lost to rounding: the shards carry the whole suite list.
  expect(loads.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 5)
})

test("a bad shard or shard count is refused rather than silently running nothing", async () => {
  const dir = await suitesDir()
  const { shardOf } = await import("./runner")
  const { loadSuites } = await import("./runner")
  const all = await loadSuites(dir)
  expect(() => shardOf(all, 0, 4)).toThrow("bad shard")
  expect(() => shardOf(all, 5, 4)).toThrow("bad shard")
  expect(() => shardOf(all, 1, 0)).toThrow("bad shard count")
})
