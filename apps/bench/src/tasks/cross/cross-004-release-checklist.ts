import { createHash } from "node:crypto"
import type { Machine, Task } from "../../types"
import { check, git, int, mulberry32, readJson, readText, run, verdict, writeJson, writeText } from "../helpers"
import {
  crossAppState,
  crossState,
  launchCrossApp,
  openCross,
  readBrowserValue,
  runCrossAppOracle,
  submitInBrowser,
} from "./support"

const LONG = { turns: 60, seconds: 1200 } as const
const CHECKS = ["Tests pass", "Artifact built", "Release notes written"]

const versionFor = (seed: number): string => {
  const rng = mulberry32(seed)
  return `v${int(rng, 2, 9)}.${int(rng, 0, 20)}.${int(rng, 0, 40)}`
}

const hashFor = (version: string): string => createHash("sha256").update(`release-${version}`).digest("hex")

const BUILD = `const config = await Bun.file("release/config.json").json()
const hash = new Bun.CryptoHasher("sha256").update("release-" + config.version).digest("hex")
await Bun.write("dist/artifact.txt", "version=" + config.version + "\\nhash=" + hash + "\\n")
console.log(hash)
`

const commit = (m: Machine) => git(m, ["commit", "-m", "Start the release"], { env: { GIT_EDITOR: "true" } })

export const releaseChecklist: Task = {
  id: "cross-004-release-checklist",
  track: "cross",
  os: ["linux"],
  needs: ["chrome", "display"],
  heldOut: false,
  kind: "long",
  prompt:
    "Do today's release. The dashboard at url.txt shows the version and the checks. Set that version in release/config.json, build the artifact with bun build.ts, publish the version and the artifact hash on the dashboard, tick every check and approve in the Release Checklist window, tag the commit with the version prefixed by v, and write RELEASED.md with the version and the hash.",
  limits: LONG,
  setup: async (m, seed) => {
    const version = versionFor(seed)
    const hash = hashFor(version)
    await writeJson(m, "request.json", { release: true })
    await writeJson(m, "release/config.json", { version: "v0.0.0" })
    await writeText(m, "build.ts", BUILD)
    await writeText(m, "release/notes.md", "Draft release notes.\n")
    await git(m, ["init", "-b", "main"])
    await git(m, ["config", "user.name", "Bench"])
    await git(m, ["config", "user.email", "bench@example.com"])
    await git(m, ["config", "core.autocrlf", "false"])
    await git(m, ["add", "-A"])
    await commit(m)
    await openCross(m, "cross-004-release-checklist", { version, hash, checks: CHECKS }, "/")
    await launchCrossApp(m, "checklist", { checks: CHECKS })
  },
  oracle: async (m) => {
    const version = await readBrowserValue("cross-004-release-checklist", m.workdir)
    await writeJson(m, "release/config.json", { version })
    const built = await run(m, ["bun", "build.ts"])
    if (built.code !== 0) throw new Error(`build failed: ${built.stderr || built.stdout}`)
    const artifact = (await readText(m, "dist/artifact.txt")) ?? ""
    const hash = artifact.match(/hash=(\S+)/)?.[1]
    if (!hash) throw new Error(`no hash in the artifact: ${artifact}`)
    await submitInBrowser("cross-004-release-checklist", m.workdir, hash)
    await runCrossAppOracle(m, "checklist")
    await git(m, ["tag", version])
    await writeText(m, "RELEASED.md", `version=${version}\nhash=${hash}\n`)
  },
  check: async (m, seed) => {
    const version = versionFor(seed)
    const hash = hashFor(version)
    const config = await readJson<{ version?: string }>(m, "release/config.json")
    const artifact = (await readText(m, "dist/artifact.txt")) ?? ""
    const page = await crossState(m)
    const release = page?.release as { version?: string; hash?: string } | undefined
    const app = await crossAppState(m)
    const tag = await git(m, ["rev-parse", "--verify", `refs/tags/${version}`])
    const head = (await git(m, ["rev-parse", "HEAD"])).stdout.trim()
    const notes = (await readText(m, "RELEASED.md")) ?? ""
    return verdict([
      check("version set", config?.version === version, `release/config.json was ${JSON.stringify(config)}`),
      check(
        "artifact built",
        artifact === `version=${version}\nhash=${hash}\n`,
        `dist/artifact.txt was ${JSON.stringify(artifact)}`,
      ),
      check(
        "release published",
        release?.version === version && release?.hash === hash,
        `dashboard state was ${JSON.stringify(release)}`,
      ),
      check("checks approved", app?.approved === true, `app state was ${JSON.stringify(app)}`),
      check(
        "all checks ticked",
        Array.isArray(app?.checks) && app.checks.length === CHECKS.length,
        `checks were ${JSON.stringify(app?.checks)}`,
      ),
      check(
        "tag created",
        tag.code === 0 && tag.stdout.trim() === head,
        `tag ${version} resolves to ${JSON.stringify(tag.stdout.trim())}`,
      ),
      check(
        "release notes written",
        notes.includes(version) && notes.includes(hash),
        `RELEASED.md was ${JSON.stringify(notes)}`,
      ),
    ])
  },
}
