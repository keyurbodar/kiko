import { pathToFileURL } from "node:url"
import type { Machine } from "../../types"
import { runBrowserOracle as resolveBrowserOracle } from "../../../fixtures/browser/oracle"
import { registry } from "../../../fixtures/browser/registry"
import { fixture, readJson, spawnTracked, waitForSpawn, writeJson, writeText } from "../helpers"

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

const startBrowser = async (m: Machine, task: string, data: unknown): Promise<string> => {
  if (!(task in registry)) throw new Error(`no browser fixture for ${task}`)
  await writeJson(m, "data.json", data)
  await spawnTracked(m, ["bun", "-e", SERVER], {
    env: {
      BENCH_REGISTRY: pathToFileURL(fixture("browser/registry.ts")).href,
      BENCH_TASK: task,
      BENCH_WORKDIR: m.workdir,
    },
  })
  await waitForSpawn(m, "server.json")
  const server = await readJson<{ port: number }>(m, "server.json")
  if (!server) throw new Error("browser fixture did not report its port")
  return `http://127.0.0.1:${server.port}`
}

export const openPage = async (m: Machine, task: string, data: unknown, path: string): Promise<void> => {
  const base = await startBrowser(m, task, data)
  await writeText(m, "url.txt", `${base}${path}\n`)
}

export const runBrowserOracle = (m: Machine, task: string): Promise<void> => resolveBrowserOracle(task, m.workdir)

export const browserState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "state.json")
