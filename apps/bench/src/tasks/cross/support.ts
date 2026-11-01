import { pathToFileURL } from "node:url"
import type { Machine } from "../../types"
import { browserDownload, browserSubmit, browserValue } from "../../../fixtures/cross/oracle"
import { registry } from "../../../fixtures/cross/registry"
import { at, fixture, python, readJson, run, spawnTracked, waitForSpawn, writeJson, writeText } from "../helpers"
import { displayEnv, macosApp, typelibEnv } from "../desktop/hard-support"

const SERVER = String.raw`
const fs = require("node:fs")
const path = require("node:path")
const { registry } = await import(process.env.BENCH_REGISTRY)
const task = process.env.BENCH_TASK
const workdir = process.env.BENCH_WORKDIR
const handlers = registry[task]
if (!handlers) {
  console.error("unknown task " + task)
  process.exit(2)
}
const data = JSON.parse(fs.readFileSync(path.join(workdir, "data.json"), "utf8"))
const statePath = path.join(workdir, "state.json")
const eventsPath = path.join(workdir, "events.jsonl")
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n")
const record = (type, payload) => {
  state[type] = payload
  save()
  fs.appendFileSync(eventsPath, JSON.stringify({ type, payload }) + "\n")
}
const ctx = { data, state, save, record }
save()
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url)
    const api = handlers.api[request.method + " " + url.pathname]
    if (api) {
      const body = request.method === "GET" ? undefined : await request.json().catch(() => ({}))
      return api(ctx, body, url)
    }
    const page = handlers.pages[url.pathname]
    if (page && request.method === "GET") return page(ctx, url)
    return new Response("not found", { status: 404 })
  },
})
fs.writeFileSync(path.join(workdir, "server.json"), JSON.stringify({ port: server.port }) + "\n")
`

export const openCross = async (m: Machine, task: string, data: unknown, path: string): Promise<void> => {
  if (!(task in registry)) throw new Error(`no cross fixture for ${task}`)
  await writeJson(m, "data.json", data)
  await spawnTracked(m, ["bun", "-e", SERVER], {
    env: {
      BENCH_REGISTRY: pathToFileURL(fixture("cross/registry.ts")).href,
      BENCH_TASK: task,
      BENCH_WORKDIR: m.workdir,
    },
  })
  await waitForSpawn(m, "server.json")
  const server = await readJson<{ port: number }>(m, "server.json")
  if (!server) throw new Error("cross fixture did not report its port")
  await writeText(m, "url.txt", `http://127.0.0.1:${server.port}${path}\n`)
}

export const crossState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "state.json")

const MACOS_SCREENS: Readonly<Record<string, string>> = {
  error: "sync_console",
  checklist: "release_checklist",
  transfer: "transfer_console",
}

export const launchCrossApp = async (m: Machine, screen: string, data: unknown): Promise<void> => {
  await writeJson(m, "app-data.json", data)
  const common = [
    "--state",
    at(m, "app-state.json"),
    "--data",
    at(m, "app-data.json"),
    "--request",
    at(m, "app-data.json"),
    "--work",
    m.workdir,
  ]
  const env: Record<string, string> = {}
  let command: string[]
  if (m.os === "macos") {
    command = [await macosApp(m), "--screen", MACOS_SCREENS[screen] ?? screen, ...common]
  } else {
    command = [python(m), fixture("cross/app.py"), "--screen", screen, ...common]
    Object.assign(env, await displayEnv(m), await typelibEnv(m))
  }
  const app = await spawnTracked(m, command, Object.keys(env).length > 0 ? { env } : {})
  await writeText(m, "app.pid", `${app.pid}\n`)
  await waitForSpawn(m, "app-state.json")
}

export const runCrossAppOracle = async (m: Machine, screen: string): Promise<void> => {
  const result = await run(m, [python(m), fixture("cross/oracle/control.py"), screen, m.workdir], {
    timeoutMs: 120_000,
  })
  if (result.code !== 0) throw new Error(`cross app oracle failed: ${result.stderr || result.stdout}`)
}

export const crossAppState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "app-state.json")

export const readBrowserValue = browserValue
export const downloadInBrowser = browserDownload
export const submitInBrowser = browserSubmit
