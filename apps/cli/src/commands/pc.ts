import { CliError, type Context } from "../context"
import type { ComputerSummary } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { withOwner } from "../owner"
import {
  describeComputer,
  diagnose,
  daemonLogTailCommand,
  failureMessage,
  pcStream,
  readDaemonLog,
  sshOutput,
  waitForComputer,
} from "./pc-add"

function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function pairCode(ctx: Context) {
  return withOwner(ctx, (client) => client["pc.pairCode"]())
}

function expiry(expiresAt: number): string {
  if (!expiresAt) return "this link works once"
  const minutes = Math.max(0, Math.round((expiresAt - Date.now()) / 60_000))
  return `this link expires in ${minutes} minutes and works once`
}

async function code(ctx: Context): Promise<void> {
  const pair = await pairCode(ctx)
  if (ctx.json) console.log(JSON.stringify({ url: pair.url, expiresAt: pair.expiresAt }))
  else console.log(`${pair.url}\n${expiry(pair.expiresAt)}`)
}

async function list(ctx: Context): Promise<void> {
  const computers = await withOwner(ctx, (client) =>
    client["user.subscribe"]({}).pipe(
      Stream.takeUntil((item) => item.kind === "synchronized"),
      Stream.runFold(
        (): readonly ComputerSummary[] => [],
        (found, item) => (item.kind === "signal" && item.signal.t === "pcState" ? item.signal.computers : found),
      ),
    ),
  )
  if (ctx.json) return console.log(JSON.stringify(computers))
  if (!computers.length) return console.log("no computers yet. run `kiko pc add <user@host>` or open the app.")
  for (const pc of computers) {
    const state = pc.online ? "online " : "offline"
    const holder = pc.holder === "human" ? "human has control" : pc.agent ? `${pc.agent.slug} is using it` : "idle"
    console.log(`${state}  ${pc.name}  ${pc.os}  ${holder}  ${pc.id}`)
  }
}

function sshArgs(ctx: Context, target: string, remote: string): string[] {
  const args = ["ssh"]
  if (ctx.port) args.push("-p", ctx.port)
  if (ctx.identity) args.push("-i", ctx.identity)
  args.push(target, remote)
  return args
}

async function add(ctx: Context): Promise<void> {
  const [target] = ctx.args
  if (!target)
    throw new CliError({
      message: "usage: kiko pc add <user@host> [--name <name>] [--port <port>] [--identity <file>]",
    })
  const pair = await pairCode(ctx)
  const known = await withOwner(ctx, (client) =>
    client["user.subscribe"]({}).pipe(
      Stream.takeUntil((item) => item.kind === "synchronized"),
      Stream.runFold(
        () => new Set<string>(),
        (ids, item) =>
          item.kind === "signal" && item.signal.t === "pcState"
            ? new Set(item.signal.computers.map((pc) => pc.id))
            : ids,
      ),
    ),
  )
  const origin = new URL(pair.url).origin
  const remote = [`curl -fsSL ${quote(`${origin}/pc/install.sh`)} | sh -s -- ${quote(pair.url)}`]
  if (ctx.name) remote.push(`--name ${quote(ctx.name)}`)
  const args = sshArgs(ctx, target, remote.join(" "))
  let exitCode: number
  try {
    exitCode = await Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited
  } catch (e) {
    throw new CliError({ message: `cannot run ssh (${e instanceof Error ? e.message : e})` })
  }
  if (exitCode !== 0) throw new CliError({ message: `ssh ${target} exited with ${exitCode}` })

  const found = await withOwner(ctx, (client) =>
    waitForComputer(pcStream(client), { name: ctx.name, known }).pipe(
      Effect.catch(() => Effect.succeed(null as ComputerSummary | null)),
    ),
  )
  if (found) {
    console.log(`kiko: ${describeComputer(found)}`)
    return
  }
  const remoteOs = await sshOutput(ctx, target, "uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/macos/'")
  const os = remoteOs === "macos" ? "macos" : remoteOs === "linux" ? "linux" : undefined
  const log = await sshOutput(ctx, target, daemonLogTailCommand(os))
  const readings = readDaemonLog(log ? log.split("\n") : [])
  throw new CliError({ message: failureMessage(diagnose(log, readings), target) })
}

export async function pc(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  if (sub === "add") return add({ ...ctx, args: ctx.args.slice(1) })
  if (sub === "list") return list(ctx)
  if (sub === "code") return code(ctx)
  throw new CliError({ message: "usage: kiko pc <add <user@host> | list | code>" })
}
