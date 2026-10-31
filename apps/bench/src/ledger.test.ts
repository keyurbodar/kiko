import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  appendRow,
  COLUMNS,
  formatRow,
  HEADER,
  parseRow,
  parseTsv,
  readRows,
  toTsv,
  unescape,
  type Row,
} from "./ledger"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-ledger-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function rowOf(value: string): Row {
  return Object.fromEntries(COLUMNS.map((column) => [column, value])) as Row
}

describe("ledger", () => {
  it("writes the exact header", () => {
    expect(toTsv([])).toBe(
      "run_id\ttrial_id\tts\tcommit\tbench_version\ttask\ttrack\theld_out\tos\tmachine\tcontender\tcontender_version\tmodel\teffort\tcondition\tseed\trep\toutcome\tpass\tchecks_passed\tchecks_total\tfail_class\tturns\ttool_calls\ttool_errors\ttokens_in\ttokens_cached\ttokens_out\ttokens_reasoning\tcost_usd\twall_ms\tmodel_ms\ttool_ms\ttool_p50_ms\ttool_p95_ms\tbytes_to_model\timages_sent\timages_dropped\tfocus_steals\tpointer_moves\tkeys_swallowed\twindows_raised\tsystem_prompt_sha\ttrajectory\n",
    )
    expect(HEADER.split("\t")).toHaveLength(44)
  })

  it("round-trips every column, including tabs, newlines and backslashes", () => {
    const value = "a\tb\nc\rd\\e"
    const row = rowOf(value)
    const parsed = parseRow(formatRow(row))
    for (const column of COLUMNS) expect(parsed[column]).toBe(value)
  })

  it("round-trips a whole file", () => {
    const rows = [rowOf("one"), rowOf("two\tlines\nand more")]
    const parsed = parseTsv(toTsv(rows))
    expect(parsed).toHaveLength(2)
    for (const column of COLUMNS) {
      expect(parsed[0]?.[column]).toBe("one")
      expect(parsed[1]?.[column]).toBe("two\tlines\nand more")
    }
  })

  it("keeps numbers and booleans readable", () => {
    const row: Row = { ...rowOf("x"), pass: 1, held_out: false, cost_usd: 0.00012345 }
    const parsed = parseRow(formatRow(row))
    expect(parsed.pass).toBe("1")
    expect(parsed.held_out).toBe("false")
    expect(parsed.cost_usd).toBe("0.00012345")
  })

  it("appends and reads a run file", async () => {
    const path = join(await tempDir(), "run.tsv")
    await appendRow(path, rowOf("first"))
    await appendRow(path, rowOf("second"))
    const rows = await readRows(path)
    expect(rows.map((row) => row.run_id)).toEqual(["first", "second"])
  })

  it("rejects a file with another header", () => {
    expect(() => parseTsv("a\tb\n1\t2\n")).toThrow()
  })

  it("leaves unknown escapes alone", () => {
    expect(unescape("a\\qb")).toBe("a\\qb")
  })
})
