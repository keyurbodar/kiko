import { dlopen } from "bun:ffi"
import { parseArgs } from "node:util"
import { configDir } from "./config"
import { detect } from "./caps"
import { CliError } from "./errors"
import { createLogger } from "./log"
import { pair } from "./pairing"
import { diagnose, serve } from "./serve"
import { service, type ServiceAction } from "./service"

const USAGE = `usage: kiko-computer <command>

  pair <url-with-#code> [--name <name>]   pair this machine with a kiko worker
  run                                     connect and serve calls
  service install|uninstall|status        keep the daemon running at logon
  doctor                                  print what this machine can do

Options: --dir <path> overrides the config directory.`

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
    if (!command || !commands.has(command)) throw new CliError(`unknown command: ${command ?? ""}\n\n${USAGE}`)
    if (command === "pair") return await runPair(dir, rest, values.name ?? null)
    if (command === "service") return await runService(rest)
    if (command === "doctor") return await runDoctor(dir)
    if (values.background) detachConsole()
    return await serve(dir)
  } catch (error) {
    console.error(`kiko-computer: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function detachConsole(): void {
  if (process.platform !== "win32") return
  try {
    dlopen("kernel32.dll", { FreeConsole: { args: [], returns: "bool" } }).symbols.FreeConsole()
  } catch {}
}

async function runPair(dir: string, rest: string[], name: string | null): Promise<number> {
  const target = rest[0]
  if (!target) throw new CliError(`pair needs the URL the web app copied\n\n${USAGE}`)
  const log = createLogger("kiko-computer")
  const detection = await detect(dir, log)
  const config = await pair(dir, detection, target, name)
  await detection.driver?.close()
  console.log(`paired ${config.name} with ${config.url}`)
  console.log(`next: kiko-computer service install, or kiko-computer run`)
  return 0
}

async function runService(rest: string[]): Promise<number> {
  const action = rest[0]
  if (!action || !serviceActions.has(action as ServiceAction)) {
    throw new CliError(`service needs one of install, uninstall, status\n\n${USAGE}`)
  }
  return service(action as ServiceAction)
}

async function runDoctor(dir: string): Promise<number> {
  const { checks, detection } = await diagnose(dir)
  await detection?.driver?.close()
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`)
  return checks.every((check) => check.ok) ? 0 : 1
}
