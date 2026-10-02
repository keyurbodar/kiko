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
