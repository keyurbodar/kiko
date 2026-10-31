import type { Machine } from "../../types"
import { at, fixture, python, readJson, run, spawnTracked, waitForSpawn, writeJson, writeText } from "../helpers"

export const HARD_LIMITS = { turns: 30, seconds: 300 } as const
export const LONG_LIMITS = { turns: 60, seconds: 1200 } as const

export interface OdsCell {
  readonly text: string
  readonly value?: string
  readonly formula?: string
  readonly type?: string
}

export interface OdsSheet {
  readonly name: string
  readonly rows: readonly (readonly (OdsCell | null)[])[]
}

export interface Ods {
  readonly sheets: readonly OdsSheet[]
  readonly charts: number
}

export const launchHard = async (
  m: Machine,
  screen: string,
  data: unknown,
  request: unknown,
  opts: { env?: Record<string, string>; layout?: string } = {},
): Promise<void> => {
  await writeJson(m, "data.json", data)
  await writeJson(m, "request.json", request)
  await run(m, ["sh", "-c", `command -v setxkbmap >/dev/null 2>&1 && setxkbmap ${opts.layout ?? "us"} || true`])
  const app = await spawnTracked(
    m,
    [
      python(m),
      fixture("desktop/hard1xx/app.py"),
      "--screen",
      screen,
      "--state",
      at(m, "state.json"),
      "--data",
      at(m, "data.json"),
      "--request",
      at(m, "request.json"),
      "--work",
      m.workdir,
    ],
    opts.env ? { env: opts.env } : {},
  )
  await writeText(m, "app.pid", `${app.pid}\n`)
  await waitForSpawn(m, "state.json")
}

export const runHardOracle = async (m: Machine, screen: string): Promise<void> => {
  const result = await run(m, ["bash", fixture(`desktop/hard1xx/oracle/${screen}.sh`), m.workdir], {
    timeoutMs: 120_000,
  })
  if (result.code !== 0) throw new Error(`desktop oracle failed: ${result.stderr || result.stdout}`)
}

export const hardState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "state.json")

const libreoffice = async (m: Machine): Promise<string> => {
  const found = await run(m, ["sh", "-c", "command -v soffice || command -v libreoffice"])
  const binary = found.stdout.trim().split("\n")[0] ?? ""
  if (!binary) throw new Error("LibreOffice is not installed")
  return binary
}

const startLibreOffice = async (m: Machine, args: readonly string[]): Promise<void> => {
  const binary = await libreoffice(m)
  const profile = `file://${at(m, "lo-profile")}`
  await run(m, [
    binary,
    "--headless",
    "--norestore",
    "--nologo",
    `-env:UserInstallation=${profile}`,
    "--terminate_after_init",
  ])
  const app = await spawnTracked(m, [binary, "--norestore", "--nologo", `-env:UserInstallation=${profile}`, ...args])
  await writeText(m, "app.pid", `${app.pid}\n`)
}

export const launchCalc = (m: Machine, rel: string): Promise<void> => startLibreOffice(m, ["--calc", at(m, rel)])

export const launchCalcBlank = (m: Machine): Promise<void> => startLibreOffice(m, ["--calc"])

export const buildOds = async (m: Machine, spec: unknown, rel: string): Promise<void> => {
  await writeJson(m, "ods-spec.json", spec)
  const result = await run(m, [
    python(m),
    fixture("desktop/hard1xx/ods.py"),
    "build",
    at(m, "ods-spec.json"),
    at(m, rel),
  ])
  if (result.code !== 0) throw new Error(`building ${rel} failed: ${result.stderr || result.stdout}`)
}

export const readOds = async (m: Machine, rel: string): Promise<Ods> => {
  const result = await run(m, [python(m), fixture("desktop/hard1xx/ods.py"), "read", at(m, rel)])
  if (result.code !== 0) throw new Error(`reading ${rel} failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as Ods
}

export const odsNumber = (cell: OdsCell | null | undefined): number | undefined => {
  if (!cell) return undefined
  if (cell.value !== undefined && cell.value !== "") {
    const parsed = Number(cell.value)
    if (Number.isFinite(parsed)) return parsed
  }
  const parsed = Number(cell.text)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const round2 = (value: number): number => Math.round(value * 100) / 100

export const closeTo = (actual: number | undefined, expected: number): boolean =>
  actual !== undefined && Math.abs(actual - expected) < 0.005
