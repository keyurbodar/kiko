import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Background, Machine } from "../types"
import { pointerCommand, sentinelCommand, sentinelSource } from "./launch"
import { parseEvents, witness, type WitnessEvent } from "./witness"

export interface Sentinel {
  stop(): Promise<Background>
}

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const READY_TIMEOUT_MS = 20_000
const EXIT_TIMEOUT_MS = 5_000
const BUILD_TIMEOUT_MS = 300_000
const POLL_MS = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readEvents(m: Machine, log: string): Promise<WitnessEvent[]> {
  const text = await m.readText(log)
  return text ? parseEvents(text) : []
}

async function waitFor(
  m: Machine,
  log: string,
  done: (events: readonly WitnessEvent[]) => boolean,
  timeoutMs: number,
): Promise<WitnessEvent[]> {
  const deadline = Date.now() + timeoutMs
  let events: WitnessEvent[] = []
  while (Date.now() < deadline) {
    events = await readEvents(m, log)
    if (done(events)) return events
    await sleep(POLL_MS)
  }
  return events
}

function failure(events: readonly WitnessEvent[], log: string): string {
  const result = witness(events)
  return result.error ?? `no sentinel events in ${log}`
}

const built = new Map<string, Promise<string>>()

function macBinary(m: Machine): Promise<string> {
  const fromEnv = process.env.KIKO_SENTINEL_BIN
  if (fromEnv) return Promise.resolve(fromEnv)
  const cached = built.get(m.workdir)
  if (cached) return cached
  const building = (async () => {
    const out = join(m.workdir, ".sentinel", "Sentinel")
    const mkdir = await m.exec(["mkdir", "-p", join(m.workdir, ".sentinel")])
    if (mkdir.code !== 0) throw new Error(`sentinel: mkdir failed: ${mkdir.stderr}`)
    const build = await m.exec(["swiftc", "-O", "-parse-as-library", sentinelSource("macos", SOURCE_DIR), "-o", out], {
      timeoutMs: BUILD_TIMEOUT_MS,
    })
    if (build.code !== 0) throw new Error(`sentinel: swiftc failed: ${build.stderr}`)
    return out
  })()
  built.set(m.workdir, building)
  return building
}

export async function startSentinel(m: Machine): Promise<Sentinel> {
  const log = join(m.workdir, "sentinel.jsonl")
  const stop = join(m.workdir, "sentinel.stop")
  const binary = m.os === "macos" ? await macBinary(m) : undefined
  const child = await m.spawn(sentinelCommand({ os: m.os, dir: SOURCE_DIR, log, stop, binary }), {
    cwd: m.workdir,
  })
  const ready = await waitFor(
    m,
    log,
    (events) => events.some((event) => event.ev === "ready" || event.ev === "error"),
    READY_TIMEOUT_MS,
  )
  if (!ready.some((event) => event.ev === "ready")) {
    await child.stop()
    throw new Error(`sentinel: ${failure(ready, log)}`)
  }
  let stopping: Promise<Background> | undefined
  return {
    stop: () => {
      stopping ??= (async () => {
        await m.writeText(stop, "stop")
        const exited = await waitFor(m, log, (events) => events.some((event) => event.ev === "exit"), EXIT_TIMEOUT_MS)
        await child.stop()
        const events = exited.length > 0 ? exited : await readEvents(m, log)
        const result = witness(events)
        if (result.error) throw new Error(`sentinel: ${result.error}`)
        return result.background
      })()
      return stopping
    },
  }
}

export async function movePointer(m: Machine, dx: number, dy: number): Promise<void> {
  const binary = m.os === "macos" ? await macBinary(m) : undefined
  const run = await m.exec(pointerCommand({ os: m.os, dir: SOURCE_DIR, binary, dx, dy }), {
    cwd: m.workdir,
    timeoutMs: 30_000,
  })
  if (run.code !== 0) throw new Error(`sentinel: pointer move failed: ${run.stderr}`)
}
