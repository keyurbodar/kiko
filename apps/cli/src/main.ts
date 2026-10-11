import { parseArgs } from "node:util"
import { composio } from "./commands/composio"
import { kernel } from "./commands/kernel"
import { health } from "./commands/health"
import { login, whoami } from "./commands/login"
import { verify } from "./commands/verify"
import { ws } from "./commands/ws"

export const defaultUrl = process.env.YUKI_URL ?? "http://localhost:8787"

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
  fake: boolean
  runs: string
  tail?: string
}

const commands: Record<string, (ctx: Context) => Promise<void>> = { health, ws, login, whoami, verify, composio, kernel }

export const usage = "usage: yuki <health | ws <path> | login --dev [--name <name>] | whoami | composio <connect | disconnect | status> | kernel <connect | disconnect | status> | verify [--list] [--no-model] [--fake] [suite...]> [--url <url>] [--json] [--idle <ms>] (--url defaults to $YUKI_URL, then http://localhost:8787)"

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
    console.error(`yuki: target ${values.url}`)
    await run({ url: values.url, json: values.json, args, idle, dev: values.dev, name: values.name, list: values.list, noModel: values["no-model"], fake: values.fake, runs: values.runs, tail: values.tail })
    return 0
  } catch (e) {
    console.error(`yuki: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
