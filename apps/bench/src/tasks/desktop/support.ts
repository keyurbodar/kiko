import type { Machine } from "../../types"
import { at, fixture, python, readJson, run, spawnTracked, waitForSpawn, writeJson, writeText } from "../helpers"

export const launch = async (m: Machine, screen: string, data: unknown, request: unknown): Promise<void> => {
  await writeJson(m, "data.json", data)
  await writeJson(m, "request.json", request)
  const app = await spawnTracked(m, [
    python(m),
    fixture("desktop/app.py"),
    "--screen",
    screen,
    "--state",
    at(m, "state.json"),
    "--data",
    at(m, "data.json"),
  ])
  await writeText(m, "app.pid", `${app.pid}\n`)
  await waitForSpawn(m, "state.json")
}

export const runDesktopOracle = async (m: Machine, screen: string): Promise<void> => {
  const result = await run(m, ["bash", fixture(`desktop/oracle/${screen}.sh`), m.workdir], { timeoutMs: 60_000 })
  if (result.code !== 0)
    throw new Error(`desktop oracle failed (exit ${result.code}): ${result.stderr || result.stdout}`)
}

export const desktopState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "state.json")
