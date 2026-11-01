import { appendFile, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

interface Row {
  readonly contender: string
  readonly os: string
  readonly version: string
  readonly installs: string
  readonly toolsListed: string
  readonly foregroundAction: string
  readonly backgroundAction: string
  readonly focusKept: string
  readonly focusBefore: string
  readonly focusAfter: string
  readonly tools: number
  readonly detail: string
}

interface Ci {
  readonly contenders: readonly string[]
  readonly runners: readonly string[]
}

function missing(contender: string, runner: string): Row {
  return {
    contender,
    os: runner,
    version: "",
    installs: "fail",
    toolsListed: "fail",
    foregroundAction: "fail",
    backgroundAction: "fail",
    focusKept: "fail",
    focusBefore: "",
    focusAfter: "",
    tools: 0,
    detail: "no result file",
  }
}

function asRow(value: unknown): Row | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.contender !== "string" || typeof record.os !== "string") return undefined
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "")
  return {
    contender: record.contender,
    os: record.os,
    version: text("version"),
    installs: text("installs"),
    toolsListed: text("toolsListed"),
    foregroundAction: text("foregroundAction"),
    backgroundAction: text("backgroundAction"),
    focusKept: text("focusKept"),
    focusBefore: text("focusBefore"),
    focusAfter: text("focusAfter"),
    tools: typeof record.tools === "number" ? record.tools : 0,
    detail: text("detail"),
  }
}

async function readRows(dir: string): Promise<Row[]> {
  const entries = await readdir(dir, { recursive: true })
  const rows: Row[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    try {
      const row = asRow(JSON.parse(await readFile(join(dir, entry), "utf8")))
      if (row) rows.push(row)
    } catch {
      continue
    }
  }
  return rows
}

function key(row: Row): string {
  return `${row.os} ${row.contender}`
}

function table(rows: readonly Row[]): string {
  const header =
    "| contender | OS | version | installs | tools listed | foreground action | background action | focus kept | focus before -> after |"
  const divider = "|---|---|---|---|---|---|---|---|---|"
  const body = rows.map(
    (row) =>
      `| ${row.contender} | ${row.os} | ${row.version} | ${row.installs} | ${row.toolsListed} (${row.tools}) | ${row.foregroundAction} | ${row.backgroundAction} | ${row.focusKept} | ${row.focusBefore} -> ${row.focusAfter} |`,
  )
  return [header, divider, ...body].join("\n")
}

function details(rows: readonly Row[]): string {
  const failures = rows.filter(
    (row) =>
      row.installs !== "pass" ||
      row.foregroundAction !== "pass" ||
      row.backgroundAction !== "pass" ||
      row.focusKept !== "pass",
  )
  if (failures.length === 0) return ""
  return ["", "### Details", ...failures.map((row) => `- ${row.contender} / ${row.os}: ${row.detail}`)].join("\n")
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? "results"
  const ci = JSON.parse(await readFile(new URL("../ci.json", import.meta.url), "utf8")) as Ci
  const found = await readRows(dir)
  const byKey = new Map(found.map((row) => [key(row), row]))
  const rows: Row[] = []
  for (const runner of ci.runners) {
    for (const contender of ci.contenders) {
      rows.push(byKey.get(`${runner} ${contender}`) ?? missing(contender, runner))
    }
  }
  const output = [table(rows), details(rows)].join("\n")
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${output}\n`)
}

await main()
