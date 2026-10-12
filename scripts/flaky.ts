// A test step that fails and passes on rerun is flaky. The rerun is the only run whose output check.ts
// keeps, so the first run's failing files are lost and nobody can tell which file flaked. This turns
// the first run's output into a compact summary: one line per failing test file with its first failing
// assertion line, ready to print under the step line.

// Two shapes of first-run output. apps/server's test-each.ts prints `FAIL <file>  <n> pass, <n> fail`
// then a few filtered detail lines. Every other package runs bun test, which prints `<file>:` as a
// header before that file's error block. A header line is nothing but the path and its colon.
const FAIL_LINE = /^FAIL\s+(\S+\.test\.tsx?)(?:\s|$)/
const HEADER_LINE = /^(\S+\.test\.tsx?):\s*$/
// A failing assertion arrives as bun's `error: ...` line or as `(fail) <test name> [time]`.
const ERROR_LINE = /^error:/
const FAIL_MARK = /^\(fail\)/
// bun run appends this after the test summary when the script exits nonzero; it names no test file.
const SCRIPT_ERROR = /^error: script ".*" exited with code \d+$/
const INDENT = "      "

export function flakyLines(output: string): string[] {
  const lines: string[] = []
  let file: string | undefined
  let first = ""
  const flush = () => {
    if (file) lines.push(`${INDENT}${file}${first ? `: ${first}` : ""}`)
  }
  for (const line of output.split("\n")) {
    const next = FAIL_LINE.exec(line)?.[1] ?? HEADER_LINE.exec(line)?.[1]
    if (next !== undefined) {
      flush()
      file = next
      first = ""
      continue
    }
    if (!file || first) continue
    if (ERROR_LINE.test(line)) {
      if (!SCRIPT_ERROR.test(line)) first = line
    } else if (FAIL_MARK.test(line)) first = line
  }
  flush()
  return lines
}
