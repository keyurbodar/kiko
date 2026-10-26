import { mkdir, open, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { Args, Value } from "@kiko/computer/wire"
import type { Policy } from "./config"
import { Fail } from "./log"
import { shellCommand } from "./platform"
import { allowedPath } from "./policy"
import { abortReason, type Deadline } from "./deadline"

const OUTPUT_CAP = 12_000
const COLLECT_CAP = 256_000
const READ_CAP = 256_000
const MAX_TIMEOUT_MS = 600_000

class Ring {
  seen = 0
  private chunks: Uint8Array[] = []
  private size = 0

  constructor(private readonly cap: number) {}

  push(chunk: Uint8Array): void {
    this.seen += chunk.byteLength
    this.chunks.push(chunk)
    this.size += chunk.byteLength
    while (this.size > this.cap && this.chunks.length > 1) {
      this.size -= this.chunks.shift()?.byteLength ?? 0
    }
    const first = this.chunks[0]
    if (this.size > this.cap && first) {
      const excess = this.size - this.cap
      this.chunks[0] = first.subarray(excess)
      this.size -= excess
    }
  }

  tail(limit: number): string {
    const text = Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
    return text.length > limit ? text.slice(text.length - limit) : text
  }
}

export async function shell(args: Args<"shell">, policy: Policy, deadline: Deadline): Promise<Value<"shell">> {
  if (!policy.shell) throw new Fail({ code: "denied", message: "policy.json turns off shell commands on this machine" })
  const budget = Math.max(1_000, Math.min(args.timeoutMs ?? 60_000, MAX_TIMEOUT_MS, deadline.remaining()))
  const proc = Bun.spawn(shellCommand(args.command), {
    cwd: args.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  })
  const ring = new Ring(COLLECT_CAP)
  const drained = Promise.all([pump(proc.stdout, ring), pump(proc.stderr, ring)])
  let timedOut = false
  const stop = () => {
    timedOut = true
    killTree(proc.pid)
  }
  const timer = setTimeout(stop, budget)
  deadline.signal.addEventListener("abort", stop, { once: true })
  try {
    const exitCode = await proc.exited
    await drained
    throwIfCancelled(deadline)
    return {
      exitCode: timedOut ? null : exitCode,
      output: ring.tail(OUTPUT_CAP),
      truncated: ring.seen > OUTPUT_CAP,
      timedOut,
    }
  } finally {
    clearTimeout(timer)
    deadline.signal.removeEventListener("abort", stop)
  }
}

function throwIfCancelled(deadline: Deadline): void {
  if (deadline.cancelled) throw abortReason(deadline.signal)
}

async function pump(stream: ReadableStream<Uint8Array> | undefined, ring: Ring): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    if (value) ring.push(value)
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" })
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

export async function read(args: Args<"read">, policy: Policy): Promise<Value<"read">> {
  const path = allowedPath(policy, args.path)
  if (!path) throw new Fail({ code: "denied", message: `${args.path} is outside the paths policy.json allows` })
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Fail({ code: "failed", message: `${args.path} is not a file this machine can read` })
  const cap = Math.max(1, Math.min(args.maxBytes ?? READ_CAP, READ_CAP))
  const size = Math.min(info.size, cap)
  const handle = await open(path, "r")
  const buffer = Buffer.alloc(size)
  try {
    await handle.read(buffer, 0, size, 0)
  } finally {
    await handle.close()
  }
  const truncated = info.size > size
  return isBinary(buffer)
    ? { size: info.size, truncated, base64: buffer.toString("base64") }
    : { size: info.size, truncated, text: buffer.toString("utf8") }
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0)
}

export async function write(args: Args<"write">, policy: Policy): Promise<Value<"write">> {
  const path = allowedPath(policy, args.path)
  if (!path) throw new Fail({ code: "denied", message: `${args.path} is outside the paths policy.json allows` })
  if (args.text === undefined && args.base64 === undefined)
    throw new Fail({ code: "failed", message: "write needs text or base64" })
  const bytes = args.base64 === undefined ? Buffer.from(args.text ?? "", "utf8") : Buffer.from(args.base64, "base64")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes, args.append ? { flag: "a" } : {})
  return { size: bytes.byteLength }
}
