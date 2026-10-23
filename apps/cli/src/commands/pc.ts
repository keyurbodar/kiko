import { CliError, type Context } from "../context"
import { askFrame } from "./user-socket"

type PairCode = { code: string; url: string; expiresAt: number }

type Computer = {
  id: string
  name: string
  os: string
  online: boolean
  holder?: "agent" | "human"
  agent?: { slug: string }
}

const TIMEOUT_MS = 30_000

function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

async function pairCode(ctx: Context): Promise<PairCode> {
  const reqId = "pc1"
  const frame = await askFrame(
    ctx,
    { t: "pc.pairCode", reqId },
    (f) => f.t === "pc.pairCode" && f.reqId === reqId,
    TIMEOUT_MS,
  )
  const url = string(frame.url)
  const code = string(frame.code)
  if (!url || !code) throw new CliError("the server sent no pair link")
  return { code, url, expiresAt: typeof frame.expiresAt === "number" ? frame.expiresAt : 0 }
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
  const frame = await askFrame(ctx, null, (f) => f.t === "pcState", TIMEOUT_MS)
  const computers = Array.isArray(frame.computers) ? (frame.computers as Computer[]) : []
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
  if (!target) throw new CliError("usage: kiko pc add <user@host> [--name <name>] [--port <port>] [--identity <file>]")
  const pair = await pairCode(ctx)
  const origin = new URL(pair.url).origin
  const remote = [`curl -fsSL ${quote(`${origin}/pc/install.sh`)} | sh -s -- ${quote(pair.url)}`]
  if (ctx.name) remote.push(`--name ${quote(ctx.name)}`)
  const args = sshArgs(ctx, target, remote.join(" "))
  let exitCode: number
  try {
    exitCode = await Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited
  } catch (e) {
    throw new CliError(`cannot run ssh (${e instanceof Error ? e.message : e})`)
  }
  if (exitCode !== 0) throw new CliError(`ssh ${target} exited with ${exitCode}`)
  console.log(`kiko: ${ctx.name ?? target} should appear in the app once the daemon connects.`)
}

export async function pc(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  if (sub === "add") return add({ ...ctx, args: ctx.args.slice(1) })
  if (sub === "list") return list(ctx)
  if (sub === "code") return code(ctx)
  throw new CliError("usage: kiko pc <add <user@host> | list | code>")
}
