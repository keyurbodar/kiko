import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createT3CodeContender } from "../src/contenders/t3code"
import { AGENT_TOOL_NAMES, T3_SOURCE_SHA, T3_VERSION } from "../src/contenders/t3code/constants"
import { startFixture } from "../src/contenders/t3code/fixture"
import { startT3Session } from "../src/contenders/t3code/session"
import { recordSnapshot } from "../src/contenders/t3code/snapshot"
import type { Check, ToolResult } from "../src/types"
import { localMachine } from "./local-machine"

const recordSchema = process.argv.includes("--record-schema")
const SNAPSHOT_PATH = join(import.meta.dir, "..", "src", "contenders", "t3code", "schema-snapshot.json")

const workdirFor = async (prefix: string): Promise<string> => {
  const configured = process.env.KIKO_BENCH_WORKDIR
  if (configured === undefined) return mkdtemp(join(tmpdir(), prefix))
  const directory = join(configured, prefix)
  await mkdir(directory, { recursive: true })
  return directory
}

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const toolNames = (tools: readonly { readonly name: string }[]): readonly string[] => tools.map((tool) => tool.name)

const requireTool = (name: string, result: ToolResult): void => {
  if (result.isError) throw new Error(`${name} failed: ${result.text.slice(0, 600)}`)
}

const buttonRef = (snapshotText: string): string | undefined => {
  for (const line of snapshotText.split(/\\n|\n/)) {
    if (!line.includes("Click me")) continue
    const match = /\[ref=(t3-[^\]\s]+)\]/.exec(line)
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}

const record = async (): Promise<void> => {
  const workdir = await workdirFor("kiko-t3code-record-")
  const session = await startT3Session({ machine: localMachine(workdir) })
  try {
    const snapshot = recordSnapshot(session.tools, {
      t3Version: T3_VERSION,
      sourceSha: T3_SOURCE_SHA,
    })
    await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)
    process.stdout.write(
      `recorded ${Object.keys(snapshot.tools).length} t3 ${T3_VERSION} tool schemas to ${SNAPSHOT_PATH}\n`,
    )
  } finally {
    await session.stop()
  }
}

const verify = async (): Promise<number> => {
  const workdir = await workdirFor("kiko-t3code-")
  const machine = localMachine(workdir)
  const fixture = await startFixture()
  const contender = createT3CodeContender()
  const checks: Check[] = []
  let version = "not-started"
  const check = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail })
    process.stdout.write(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}\n`)
  }

  try {
    await contender.start(machine, "foreground")
    version = contender.version
    const tools = contender.tools()
    const names = toolNames(tools)
    const missing = AGENT_TOOL_NAMES.filter((name) => !names.includes(name))
    check(
      "tools/list",
      missing.length === 0 && names.includes("bash"),
      `t3 ${version} exposed ${names.length} tools: ${names.join(", ")}${missing.length === 0 ? "" : `; missing ${missing.join(", ")}`}`,
    )

    const status = await contender.call("preview_status", {}, AbortSignal.timeout(30_000))
    check("thread caller", !status.isError, status.text.slice(0, 200))
    requireTool("preview_status", status)

    const open = await contender.call("preview_open", { url: fixture.url, open: false }, AbortSignal.timeout(120_000))
    requireTool("preview_open", open)
    check("preview_open", open.text.includes("127.0.0.1"), open.text.slice(0, 300))

    const waited = await contender.call("preview_wait_for", { text: "Click me" }, AbortSignal.timeout(60_000))
    requireTool("preview_wait_for", waited)

    const snapshot = await contender.call("preview_snapshot", {}, AbortSignal.timeout(120_000))
    requireTool("preview_snapshot", snapshot)
    const ref = buttonRef(snapshot.text)
    check("preview_snapshot", ref !== undefined, `button ref ${ref ?? "not found"}`)
    if (ref === undefined) throw new Error("preview_snapshot returned no button ref")

    const clicked = await contender.call(
      "preview_act",
      { action: "click", locator: `aria-ref=${ref}` },
      AbortSignal.timeout(60_000),
    )
    requireTool("preview_act", clicked)
    const count = await withTimeout(fixture.clicked, 30_000, "fixture click")
    check("preview_act click", count >= 1, `fixture recorded ${count} click(s)`)

    await writeFile(
      join(workdir, "t3code-verify.json"),
      `${JSON.stringify({ version, threadTools: names, checks, workdir }, null, 2)}\n`,
    )
  } finally {
    await contender.stop()
    await fixture.close()
  }

  const failed = checks.filter((entry) => !entry.pass)
  process.stdout.write(
    `\nt3code contender ${version} on ${machine.id}: ${checks.length - failed.length}/${checks.length} checks passed\n`,
  )
  return failed.length === 0 ? 0 : 1
}

const exitCode = recordSchema ? await record().then(() => 0) : await verify()
process.exit(exitCode)
