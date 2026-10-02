import { parseArgs } from "node:util"
import { executor } from "./commands/executor"
import { health } from "./commands/health"
import { ws } from "./commands/ws"

export const defaultUrl = "http://localhost:8787"

export class CliError extends Error {}

export interface Context {
  url: string
  json: boolean
  args: string[]
  idle: number
}

const commands: Record<string, (ctx: Context) => Promise<void>> = { health, ws, executor }

export const usage = "usage: kiko <health | ws <path> | executor <probe | discover>> [--url <url>] [--json] [--idle <ms>]"

export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        url: { type: "string", default: defaultUrl },
        json: { type: "boolean", default: false },
        idle: { type: "string", default: "1000" },
      },
    })
    const [name, ...args] = positionals
    const run = name ? commands[name] : undefined
    if (!run) throw new CliError(name ? `unknown command: ${name}. ${usage}` : usage)
    const idle = Number(values.idle)
    if (!Number.isFinite(idle) || idle < 0) throw new CliError(`bad --idle: ${values.idle}`)
    await run({ url: values.url, json: values.json, args, idle })
    return 0
  } catch (e) {
    console.error(`kiko: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
