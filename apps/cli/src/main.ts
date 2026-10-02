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
  /** `verify --fake`: suites may use the dev-only fake provider. */
  fake: boolean
  runs: string
  tail?: string
}

const commands: Record<string, (ctx: Context) => Promise<void>> = { health, ws, login, whoami, verify, executor, measure }

export const usage = "usage: kiko <health | ws <path> | login --dev [--name <name>] | whoami | executor <probe | discover> | measure turn [--runs <n>] [--tail <file>] | verify [--list] [--no-model] [--fake] [suite...]> [--url <url>] [--json] [--idle <ms>]"

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
        fake: { type: "boolean", default: false },
        runs: { type: "string", default: "5" },
        tail: { type: "string" },
      },
    })
    const [name, ...args] = positionals
    const run = name ? commands[name] : undefined
    if (!run) throw new CliError(name ? `unknown command: ${name}. ${usage}` : usage)
    const idle = Number(values.idle)
    if (!Number.isFinite(idle) || idle < 0) throw new CliError(`bad --idle: ${values.idle}`)
    await run({ url: values.url, json: values.json, args, idle, dev: values.dev, name: values.name, list: values.list, noModel: values["no-model"], fake: values.fake, runs: values.runs, tail: values.tail })
    return 0
  } catch (e) {
    console.error(`kiko: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
