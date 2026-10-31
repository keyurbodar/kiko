import type { Machine, Task } from "../../types"
import { bun, check, git, LIMITS, readText, run, verdict, writeJson, writeText } from "../helpers"

const FILLERS = 200

const BASE_INVOICE = `export const buildInvoice = (input: { amount: number }): { total: number } => ({ total: input.amount })
`

const RENAMED_INVOICE = `export const buildInvoice = (input: { total: number }): { total: number } => ({ total: input.total })
`

const BASE_CHECKOUT = `import { buildInvoice } from "./invoice"

export const checkout = (amount: number): number => buildInvoice({ amount }).total
`

const RENAMED_CHECKOUT = `import { buildInvoice } from "./invoice"

export const checkout = (total: number): number => buildInvoice({ total }).total
`

const BASE_TEST = `import { expect, test } from "bun:test"
import { checkout } from "./checkout"

test("checkout returns the total", () => {
  expect(checkout(100)).toBe(100)
})
`

const FEATURE_REPORT = `import { buildInvoice } from "./invoice"

export const report = (): number => buildInvoice({ amount: 250 }).total
`

const FIXED_REPORT = `import { buildInvoice } from "./invoice"

export const report = (): number => buildInvoice({ total: 250 }).total
`

const FEATURE_TEST = `import { expect, test } from "bun:test"
import { report } from "./report"

test("report shows the invoice total", () => {
  expect(report()).toBe(250)
})
`

const filler = (index: number): string => `export const m${String(index).padStart(3, "0")} = ${index * 7 + 1}\n`

const commit = (m: Machine, message: string) => git(m, ["commit", "-m", message], { env: { GIT_EDITOR: "true" } })

export const mergeConflict200: Task = {
  id: "terminal-104-merge-conflict-200",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "Merge the feature branch into main. Git merges it without a complaint, but the tests are red afterwards. Fix the code so the suite passes, then leave main checked out with a clean tree.",
  limits: LIMITS,
  setup: async (m) => {
    await writeJson(m, "request.json", { branch: "feature" })
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await writeText(m, "src/invoice.ts", BASE_INVOICE)
    await writeText(m, "src/checkout.ts", BASE_CHECKOUT)
    await writeText(m, "src/checkout.test.ts", BASE_TEST)
    for (let index = 1; index <= FILLERS; index += 1)
      await writeText(m, `src/modules/m${String(index).padStart(3, "0")}.ts`, filler(index))
    await git(m, ["add", "-A"])
    await commit(m, "Start the invoice module")
    await git(m, ["checkout", "-b", "feature"])
    await writeText(m, "src/report.ts", FEATURE_REPORT)
    await writeText(m, "src/report.test.ts", FEATURE_TEST)
    await git(m, ["add", "-A"])
    await commit(m, "Add the monthly report")
    await git(m, ["checkout", "main"])
    await writeText(m, "src/invoice.ts", RENAMED_INVOICE)
    await writeText(m, "src/checkout.ts", RENAMED_CHECKOUT)
    await git(m, ["add", "-A"])
    await commit(m, "Name the invoice total explicitly")
  },
  oracle: async (m) => {
    const merged = await git(m, ["merge", "feature", "--no-ff", "-m", "Merge the monthly report"])
    if (merged.code !== 0) throw new Error(`merge failed: ${merged.stderr || merged.stdout}`)
    await writeText(m, "src/report.ts", FIXED_REPORT)
    await git(m, ["add", "src/report.ts"])
    await commit(m, "Use the renamed invoice field in the report")
    const tests = await run(m, ["bun", "test"])
    if (tests.code !== 0) throw new Error(`tests failed: ${tests.stderr || tests.stdout}`)
  },
  check: async (m) => {
    const tests = await run(m, ["bun", "test"])
    const branch = (await git(m, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim()
    const status = (await git(m, ["status", "--porcelain"])).stdout.trim()
    const ancestor = await git(m, ["merge-base", "--is-ancestor", "feature", "main"])
    const invoice = await readText(m, "src/invoice.ts")
    const report = await readText(m, "src/report.ts")
    const marker = `${invoice ?? ""}${report ?? ""}`
    const sample = await readText(m, "src/modules/m200.ts")
    return verdict([
      check(
        "tests pass",
        tests.code === 0,
        `bun test exited ${tests.code}: ${(tests.stderr || tests.stdout).slice(-400)}`,
      ),
      check("on main", branch === "main", `HEAD was ${JSON.stringify(branch)}`),
      check("clean tree", status === "", `git status --porcelain was ${JSON.stringify(status)}`),
      check("feature merged", ancestor.code === 0, `feature is not an ancestor of main`),
      check(
        "no conflict markers",
        !marker.includes("<<<<<<<") && !marker.includes(">>>>>>>"),
        "conflict markers remain",
      ),
      check("other files kept", sample === filler(200), `src/modules/m200.ts was ${JSON.stringify(sample)}`),
    ])
  },
}
