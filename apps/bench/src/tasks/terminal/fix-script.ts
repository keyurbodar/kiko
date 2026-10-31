import { join } from "node:path"

import type { Machine, Task, Verdict } from "../../types"

function scriptPath(m: Machine): string {
  return join(m.workdir, m.os === "windows" ? "double.ps1" : "double.sh")
}

async function setupDouble(m: Machine): Promise<void> {
  const path = scriptPath(m)
  if (m.os === "windows") {
    await m.writeText(path, "param([int]$n)\nWrite-Output ($n + 1)\n")
    return
  }
  await m.writeText(path, "#!/bin/sh\necho $(( $1 + 1 ))\n")
  await m.exec(["chmod", "+x", path])
}

async function oracleDouble(m: Machine): Promise<void> {
  const path = scriptPath(m)
  await m.writeText(
    path,
    m.os === "windows" ? "param([int]$n)\nWrite-Output ($n * 2)\n" : "#!/bin/sh\necho $(( $1 + $1 ))\n",
  )
}

async function checkDouble(m: Machine): Promise<Verdict> {
  const path = scriptPath(m)
  const command =
    m.os === "windows"
      ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${path}' 5`]
      : ["/bin/sh", path, "5"]
  const result = await m.exec(command)
  const name = m.os === "windows" ? "double.ps1 prints 10" : "double.sh prints 10"
  const pass = result.stdout.trim() === "10"
  const detail = `stdout ${JSON.stringify(result.stdout.trim())}, stderr ${JSON.stringify(result.stderr.trim())}, exit ${result.code}`
  return { pass, checks: [{ name, pass, detail }] }
}

export const fixScript: Task = {
  id: "terminal-002-fix-script",
  track: "terminal",
  os: ["macos", "windows", "linux"],
  needs: [],
  heldOut: false,
  prompt:
    "the script in this folder should print double the number you pass it, but it prints the wrong answer. fix it so that running it with 5 prints 10",
  limits: { turns: 12, seconds: 180 },
  setup: setupDouble,
  oracle: oracleDouble,
  check: checkDouble,
}
