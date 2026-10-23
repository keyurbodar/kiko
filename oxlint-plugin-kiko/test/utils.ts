import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { assert, it } from "@effect/vitest"

const oxlintBin = join(dirname(createRequire(import.meta.url).resolve("oxlint/package.json")), "bin", "oxlint")
const pluginPath = join(import.meta.dirname, "..", "index.ts")

type RuleHarnessOptions = {
  readonly filename?: string
  readonly ruleOptions?: ReadonlyArray<unknown>
}

type RuleHarness = {
  readonly valid: (name: string, source: string) => void
  readonly invalid: (name: string, source: string, assertion?: (output: string) => void) => void
}

export function createOxlintRuleHarness(ruleName: string, options: RuleHarnessOptions = {}): RuleHarness {
  const [pluginName, shortRuleName] = ruleName.split("/")
  const diagnostic = new RegExp(pluginName && shortRuleName ? `${pluginName}\\(${shortRuleName}\\)` : ruleName)

  const run = (source: string) => {
    const dir = mkdtempSync(join(tmpdir(), "kiko-oxlint-"))
    try {
      const configPath = join(dir, ".oxlintrc.json")
      const sourcePath = join(dir, options.filename ?? "fixture.ts")
      writeFileSync(
        configPath,
        JSON.stringify({
          jsPlugins: [{ name: "kiko", specifier: pluginPath }],
          rules: { [ruleName]: ["error", ...(options.ruleOptions ?? [])] },
        }),
      )
      writeFileSync(sourcePath, source)
      const result = spawnSync(process.execPath, [oxlintBin, "--config", configPath, sourcePath], { encoding: "utf8" })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    valid(name, source) {
      it(name, () => {
        const { status, output } = run(source)
        assert.strictEqual(status, 0, output)
      })
    },
    invalid(name, source, assertion) {
      it(name, () => {
        const { status, output } = run(source)
        assert.notStrictEqual(status, 0, `expected ${ruleName} to report, but oxlint passed`)
        assert.match(output, diagnostic)
        assertion?.(output)
      })
    },
  }
}
