import { parseArgs } from "node:util"
import { configDir } from "./config"
import { presence } from "./caps"
import { preflightAccess } from "./desk/macos"
import { CliError } from "./errors"
import { pair } from "./pairing"
import { diagnose, serve } from "./serve"

const USAGE = `usage: kiko-core <command>

  pair <url-with-#code> [--name <name>]   pair this machine with a kiko worker
  run                                     connect and serve calls
  doctor                                  print what this machine can do

Options: --dir <path> overrides the config directory.`

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      dir: { type: "string" },
      help: { type: "boolean", default: false, short: "h" },
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
    if (command === "pair") return await runPair(dir, rest, values.name ?? null)
    if (command === "doctor") return await runDoctor(dir)
    if (command === "run") return await serve(dir)
    throw new CliError({ message: `unknown command: ${command ?? ""}\n\n${USAGE}` })
  } catch (error) {
    console.error(`kiko-core: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

function runAccess(): number {
  const access = process.platform === "darwin" ? preflightAccess() : { screen: true, input: true }
  console.log(JSON.stringify(access))
  return 0
}

async function runPair(dir: string, rest: string[], name: string | null): Promise<number> {
  const target = rest[0]
  if (!target) throw new CliError({ message: `pair needs the URL the web app copied\n\n${USAGE}` })
  const config = await pair(dir, presence(), target, name)
  console.log(`paired ${config.name} with ${config.url}`)
  console.log("next: start the kiko app, or run the install command again")
  return 0
}

async function runDoctor(dir: string): Promise<number> {
  const { checks, detection } = await diagnose(dir)
  detection?.backend?.close()
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`)
  return checks.every((check) => check.ok) ? 0 : 1
}
