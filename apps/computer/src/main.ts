import { dlopen } from "bun:ffi"
import { parseArgs } from "node:util"
import { readFile, stat } from "node:fs/promises"
import { configDir, paths } from "./config"
import { presence } from "./caps"
import { preflightAccess } from "./desk/macos"
import { CliError } from "./errors"
import { pair } from "./pairing"
import { diagnose, serve, WELCOMED } from "./serve"
import { service, type ServiceAction } from "./service"
import { supervise } from "./supervise"

const USAGE = `usage: kiko-computer <command>

  pair <url-with-#code> [--name <name>]   pair this machine with a kiko worker
  run                                     connect and serve calls
  service install|uninstall|status        keep the daemon running at logon
  doctor                                  print what this machine can do

Options: --dir <path> overrides the config directory.`

const CONNECT_WAIT_MS = 20_000
const CONNECT_POLL_MS = 500

const commands = new Set(["pair", "run", "service", "doctor"])
const serviceActions = new Set<ServiceAction>(["install", "uninstall", "status"])

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      dir: { type: "string" },
      help: { type: "boolean", default: false, short: "h" },
      background: { type: "boolean", default: false },
    },
  })
  if (values.help || positionals.length === 0) {
    console.log(USAGE)
    return values.help ? 0 : 1
  }
  const dir = values.dir ?? configDir()
  const [command, ...rest] = positionals
  try {
    if (command === "access") return runAccess()
    if (command === "supervise") {
      const daemon = rest[0]
      if (!daemon) throw new CliError({ message: "supervise needs the daemon path" })
      return await supervise(daemon)
    }
    if (!command || !commands.has(command))
      throw new CliError({ message: `unknown command: ${command ?? ""}\n\n${USAGE}` })
    if (command === "pair") return await runPair(dir, rest, values.name ?? null)
    if (command === "service") return await runService(dir, rest)
    if (command === "doctor") return await runDoctor(dir)
    if (values.background) detachConsole()
    return await serve(dir)
  } catch (error) {
    console.error(`kiko-computer: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function runAccess(): number {
  const access = process.platform === "darwin" ? preflightAccess() : { screen: true, input: true }
  console.log(JSON.stringify(access))
  return 0
}

function detachConsole(): void {
  if (process.platform !== "win32") return
  try {
    dlopen("kernel32.dll", { FreeConsole: { args: [], returns: "bool" } }).symbols.FreeConsole()
  } catch {}
}

async function runPair(dir: string, rest: string[], name: string | null): Promise<number> {
  const target = rest[0]
  if (!target) throw new CliError({ message: `pair needs the URL the web app copied\n\n${USAGE}` })
  const config = await pair(dir, presence(), target, name)
  console.log(`paired ${config.name} with ${config.url}`)
  console.log(`next: kiko-computer service install, or kiko-computer run`)
  return 0
}

async function runService(dir: string, rest: string[]): Promise<number> {
  const action = rest[0]
  if (!action || !serviceActions.has(action as ServiceAction)) {
    throw new CliError({ message: `service needs one of install, uninstall, status\n\n${USAGE}` })
  }
  if (action !== "install") return service(action as ServiceAction)
  const log = paths(dir).log
  const from = await logSize(log)
  const code = await service("install")
  if (code !== 0) return code
  const lines = await connection(log, from)
  if (lines.some((line) => line.includes(WELCOMED))) {
    console.log("connected. This computer is online in kiko.")
    return 0
  }
  console.log(`not connected after ${CONNECT_WAIT_MS / 1000}s. It keeps trying in the background.`)
  for (const line of lines.slice(-3)) console.log(`  ${line}`)
  console.log(`full log: ${log}`)
  return 0
}

async function logSize(file: string): Promise<number> {
  return stat(file).then(
    (info) => info.size,
    () => 0,
  )
}

async function connection(file: string, from: number): Promise<string[]> {
  const until = Date.now() + CONNECT_WAIT_MS
  for (;;) {
    const bytes = await readFile(file).catch(() => Buffer.alloc(0))
    const lines = bytes.subarray(from).toString("utf8").split("\n").filter(Boolean)
    if (Date.now() >= until || lines.some((line) => line.includes(WELCOMED))) return lines
    await Bun.sleep(CONNECT_POLL_MS)
  }
}

async function runDoctor(dir: string): Promise<number> {
  const { checks, detection } = await diagnose(dir)
  detection?.backend?.close()
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`)
  return checks.every((check) => check.ok) ? 0 : 1
}
