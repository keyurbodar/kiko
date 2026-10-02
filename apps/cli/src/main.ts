import { parseArgs } from "node:util"
import { executor } from "./commands/executor"
import { health } from "./commands/health"
import { login, whoami } from "./commands/login"
import { measure } from "./commands/measure"
import { verify } from "./commands/verify"
import { ws } from "./commands/ws"

export const defaultUrl = "http://localhost:8787"

export class CliError extends Error {}

export interface Context {
  url: string
  json: boolean
  args: string[]
  idle: number
  dev: boolean
  name: string
  list: boolean
  noModel: boolean
  coalesce: boolean
  ms: number
}

const commands: Record<string, (ctx: Context) => Promise<void>> = { health, ws, login, whoami, verify, executor, measure }

export const usage = "usage: kiko <health | ws <path> | login --dev [--name <name>] | whoami | executor <probe | discover> | verify [--list] [--no-model] [suite...] | measure turn [--coalesce] [--ms <ms>]> [--url <url>] [--json] [--idle <ms>]"

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
        name: { type: "string", default: "dev" },
        list: { type: "boolean", default: false },
        "no-model": { type: "boolean", default: false },
        coalesce: { type: "boolean", default: false },
        ms: { type: "string", default: "15000" },
      },
    })
    const [name, ...args] = positionals
    const run = name ? commands[name] : undefined
    if (!run) throw new CliError(name ? `unknown command: ${name}. ${usage}` : usage)
    const idle = Number(values.idle)
    if (!Number.isFinite(idle) || idle < 0) throw new CliError(`bad --idle: ${values.idle}`)
    const ms = Number(values.ms)
    if (!Number.isFinite(ms) || ms <= 0) throw new CliError(`bad --ms: ${values.ms}`)
    await run({ url: values.url, json: values.json, args, idle, dev: values.dev, name: values.name, list: values.list, noModel: values["no-model"], coalesce: values.coalesce, ms })
    return 0
  } catch (e) {
    console.error(`kiko: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
