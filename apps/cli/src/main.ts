import { parseArgs } from "node:util"
import { composio } from "./commands/composio"
import { kernel } from "./commands/kernel"
import { health } from "./commands/health"
import { login, whoami } from "./commands/login"
import { pc } from "./commands/pc"
import { ws } from "./commands/ws"
import { CliError, type Context } from "./context"

const defaultUrl = process.env.KIKO_URL ?? "http://localhost:8787"

const withSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`)

const commands: Record<string, (ctx: Context) => Promise<void>> = {
  health,
  ws,
  login,
  whoami,
  composio,
  kernel,
  pc,
}

const usage =
  "usage: kiko <health | ws <path> | login --dev [--name <name>] | whoami | pc <add <user@host> | list | code> | composio <connect | disconnect | status> | kernel <connect | disconnect | status>> [--url <url>] [--json] [--idle <ms>] (--url defaults to $KIKO_URL, then http://localhost:8787)"

export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        url: { type: "string", default: defaultUrl },
        json: { type: "boolean", default: false },
        idle: { type: "string", default: "1000" },
        dev: { type: "boolean", default: false },
        name: { type: "string" },
        port: { type: "string" },
        identity: { type: "string" },
        runs: { type: "string", default: "5" },
        tail: { type: "string" },
      },
    })
    const [name, ...args] = positionals
    const run = name ? commands[name] : undefined
    if (!run) throw new CliError({ message: name ? `unknown command: ${name}. ${usage}` : usage })
    const idle = Number(values.idle)
    if (!Number.isFinite(idle) || idle < 0) throw new CliError({ message: `bad --idle: ${values.idle}` })
    console.error(`kiko: target ${values.url}`)
    await run({
      url: withSlash(values.url),
      json: values.json,
      args,
      idle,
      dev: values.dev,
      name: values.name,
      port: values.port,
      identity: values.identity,
      runs: values.runs,
      tail: values.tail,
    })
    return 0
  } catch (e) {
    console.error(`kiko: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
