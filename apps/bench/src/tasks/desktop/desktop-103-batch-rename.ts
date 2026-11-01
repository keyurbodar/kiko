import type { Task } from "../../types"
import { at, check, int, mulberry32, pick, readText, run, sample, verdict } from "../helpers"
import { HARD_LIMITS, launchHard, runHardOracle } from "./hard-support"

const FILES = ["receipt.txt", "invoice.txt", "contract.txt", "letter.txt", "notes.txt", "summary.txt", "quote.txt"]
const PREFIXES = ["scan", "archive", "client", "2026", "signed"]

const batch = (seed: number) => {
  const rng = mulberry32(seed)
  return { files: sample(rng, FILES, 5), prefix: pick(rng, PREFIXES), start: int(rng, 1, 20) }
}

const renamed = (seed: number): string[] => {
  const data = batch(seed)
  return data.files.map((name, index) => {
    const extension = name.slice(name.lastIndexOf("."))
    return `${data.prefix}-${data.start + index}${extension}`
  })
}

const body = (name: string): string => `${name} body\n`

export const desktopBatchRename: Task = {
  id: "desktop-103-batch-rename",
  track: "desktop",
  kind: "real",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "The docs folder is open in the file tool. Rename every file in it to the prefix and starting number in request.json, keeping the files' contents and their extensions.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    const data = batch(seed)
    await run(m, ["mkdir", "-p", at(m, "docs")])
    for (const name of data.files) await m.writeText(at(m, "docs", name), body(name))
    await launchHard(m, "rename", { files: data.files }, { prefix: data.prefix, start: data.start })
  },
  oracle: (m) => runHardOracle(m, "rename"),
  check: async (m, seed) => {
    const data = batch(seed)
    const expected = renamed(seed)
    const checks = await Promise.all(
      expected.map(async (name, index) => {
        const content = await readText(m, `docs/${name}`)
        return check(
          `renamed ${data.files[index]}`,
          content === body(data.files[index] ?? ""),
          `docs/${name} was ${JSON.stringify(content)}`,
        )
      }),
    )
    const originals = await Promise.all(data.files.map((name) => readText(m, `docs/${name}`)))
    const listing = await run(m, ["ls", "-1", at(m, "docs")])
    const entries = listing.stdout.split("\n").filter(Boolean)
    return verdict([
      ...checks,
      check(
        "old names are gone",
        originals.every((content) => content === undefined),
        `old names left: ${data.files.filter((_name, index) => originals[index] !== undefined).join(", ")}`,
      ),
      check("no extra files", entries.length === expected.length, `docs holds ${entries.length} entries`),
    ])
  },
}
