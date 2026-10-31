import type { Task } from "../../types"
import { bun, check, readText, readJson, run, verdict, writeJson, writeText } from "../helpers"

const LONG = { turns: 60, seconds: 1200 } as const

const MODULES = ["alpha", "beta", "gamma", "delta", "epsilon"]

const LOGGER_ONE = `export const log = (level, message) => "[" + level + "] " + message
`

const LOGGER_TWO = `const emit = (level, message) => "[" + level.toUpperCase() + "] " + message

export const logger = {
  info: (message) => emit("info", message),
  warn: (message) => emit("warn", message),
  error: (message) => emit("error", message),
}
`

const pkg = (name: string, version: string): string =>
  `${JSON.stringify({ name, version, type: "module", main: "index.js" }, null, 2)}\n`

const V1_SITE = (name: string): string => `import { log } from "logger"

export const ${name} = (): string =>
  [log("info", "start ${name}"), log("warn", "slow ${name}"), log("error", "stop ${name}")].join("|")
`

const V2_SITE = (name: string): string => `import { logger } from "logger"

export const ${name} = (): string =>
  [logger.info("start ${name}"), logger.warn("slow ${name}"), logger.error("stop ${name}")].join("|")
`

const expected = (name: string): string =>
  [`[INFO] start ${name}`, `[WARN] slow ${name}`, `[ERROR] stop ${name}`].join("|")

const TEST = `import { expect, test } from "bun:test"
${MODULES.map((name) => `import { ${name} } from "./${name}"`).join("\n")}

${MODULES.map(
  (name) => `test("${name} logs at three levels", () => {
  expect(${name}()).toBe(${JSON.stringify(expected(name))})
})`,
).join("\n\n")}
`

const ROOT_PKG = `${JSON.stringify(
  { name: "upgrade-demo", type: "module", dependencies: { logger: "file:vendor/logger-1" } },
  null,
  2,
)}\n`

export const depUpgrade: Task = {
  id: "terminal-108-dep-upgrade",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "long",
  prompt:
    "We have to move to logger 2.0. It is already vendored in vendor/logger-2, and the 2.0 API is different. Update the project so the tests pass against 2.0, and leave the old vendored copy alone.",
  limits: LONG,
  setup: async (m) => {
    await writeJson(m, "request.json", { version: "2.0.0" })
    await writeText(m, "package.json", ROOT_PKG)
    await writeText(m, "vendor/logger-1/package.json", pkg("logger", "1.0.0"))
    await writeText(m, "vendor/logger-1/index.js", LOGGER_ONE)
    await writeText(m, "vendor/logger-2/package.json", pkg("logger", "2.0.0"))
    await writeText(m, "vendor/logger-2/index.js", LOGGER_TWO)
    for (const name of MODULES) await writeText(m, `src/${name}.ts`, V1_SITE(name))
    await writeText(m, "src/log.test.ts", TEST)
    const install = await run(m, ["bun", "install"], { timeoutMs: 120_000 })
    if (install.code !== 0) throw new Error(`bun install failed: ${install.stderr || install.stdout}`)
  },
  oracle: async (m) => {
    await writeText(
      m,
      "package.json",
      `${JSON.stringify(
        { name: "upgrade-demo", type: "module", dependencies: { logger: "file:vendor/logger-2" } },
        null,
        2,
      )}\n`,
    )
    const install = await run(m, ["bun", "install"], { timeoutMs: 120_000 })
    if (install.code !== 0) throw new Error(`bun install failed: ${install.stderr || install.stdout}`)
    for (const name of MODULES) await writeText(m, `src/${name}.ts`, V2_SITE(name))
    const tests = await run(m, ["bun", "test"])
    if (tests.code !== 0) throw new Error(`tests failed: ${tests.stderr || tests.stdout}`)
  },
  check: async (m) => {
    const tests = await run(m, ["bun", "test"])
    const pkgJson = await readJson<{ dependencies?: Record<string, string> }>(m, "package.json")
    const dependency = pkgJson?.dependencies?.logger ?? ""
    const testFile = await readText(m, "src/log.test.ts")
    const vendorOne = await readText(m, "vendor/logger-1/index.js")
    const old = await bun(
      m,
      `const fs = require("node:fs")
const names = fs.readdirSync("src").filter((name) => name.endsWith(".ts") && name !== "log.test.ts")
const stale = names.filter((name) => fs.readFileSync("src/" + name, "utf8").includes("log("))
console.log(JSON.stringify(stale))`,
    )
    let stale: string[] = []
    try {
      stale = JSON.parse(old.stdout.trim()) as string[]
    } catch {}
    return verdict([
      check(
        "tests pass",
        tests.code === 0,
        `bun test exited ${tests.code}: ${(tests.stderr || tests.stdout).slice(-400)}`,
      ),
      check(
        "logger 2 installed",
        dependency.includes("logger-2"),
        `package.json logger was ${JSON.stringify(dependency)}`,
      ),
      check("call sites migrated", stale.length === 0, `still using the old log(): ${JSON.stringify(stale)}`),
      check("tests untouched", testFile === TEST, "src/log.test.ts changed"),
      check("old vendor untouched", vendorOne === LOGGER_ONE, "vendor/logger-1/index.js changed"),
    ])
  },
}
