import { stat } from "node:fs/promises"
import { PROTOCOL, type Holder } from "@kiko/computer/wire"
import { detect, type Detection } from "./caps"
import { configDir, loadConfig, loadKey, loadPolicy, paths } from "./config"
import { runLink, type Host } from "./connection"
import { helloPayload } from "./hello"
import { emptyLive, startLive, type Live } from "./live"
import type { LiveCaps } from "./live"
import { createLogger, type Logger } from "./log"

const REDETECT_MS = 10 * 60 * 1000
const REPAIR_POLL_MS = 30_000

export async function serve(dir = configDir()): Promise<number> {
  const log = createLogger("kiko-computer", paths(dir).log)
  const config = await loadConfig(dir)
  if (!config) {
    log.error("this machine is not paired yet; run kiko-computer pair <url-with-#code>")
    return 1
  }
  const key = await loadKey(dir)
  if (!key) {
    log.error(`key.jwk is missing from ${dir}; pair this machine again`)
    return 1
  }
  await warnOnLooseKey(dir, log)
  let holder: Holder = "agent"
  const setHolder = (next: Holder) => {
    holder = next
    log.info(next === "human" ? "the owner took control of this screen" : "the owner handed this screen back")
  }
  const policy = await loadPolicy(dir)
  let live: Live = emptyLive({ logger: log, setHolder })
  let detection = await detect(dir, log, policy)
  const host: Host = {
    endpoint: { url: config.url, userId: config.userId, pcId: config.pcId, protocol: PROTOCOL },
    key,
    hello: () => JSON.stringify(helloPayload(detection)),
    policy: () => loadPolicy(dir),
    desktop: () => detection.desktop,
    live: {
      rtc: (frame) => live.frames.rtc(frame),
      live: (frame) => live.frames.live(frame),
      input: (frame) => live.frames.input(frame),
      control: (frame) => live.frames.control(frame),
      ack: (frame) => live.frames.ack(frame),
    },
    holder: () => holder,
    log,
    onWelcome: (name) => log.info(`the worker calls this machine ${name}`),
  }
  const link = runLink(host)
  if (detection.caps.live) {
    live = await startLive({
      logger: log,
      setHolder,
      send: (frame) => link.frame(frame),
      sendBinary: (bytes) => link.binary(bytes),
      policy: () => policy,
      display: () => detection.displays[0],
      configDir: dir,
    })
  }
  const point = (next: Detection) => {
    if (next.desktop) next.desktop.pointer = (x, y) => live.agentCursor(x, y)
  }
  point(detection)
  const shutdown = () => {
    log.info("stopping")
    link.stop()
    void live.close()
    void detection.driver?.close()
    process.exit(0)
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  log.info(
    `${config.name} connecting to ${config.url} with ${detection.caps.desktop ? "desktop tools" : "shell and files only"}`,
  )
  const refresh = setInterval(() => {
    void redetect(dir, log, policy, () => detection).then((next) => {
      if (!next) return
      detection = next
      point(next)
    })
  }, REDETECT_MS)
  try {
    await link.loop()
  } finally {
    clearInterval(refresh)
  }
  if (!link.removed) return 0
  await live.close()
  await detection.driver?.close().catch(() => undefined)
  await repaired(dir, config.pcId)
  log.info("paired again; restarting")
  return 0
}

async function repaired(dir: string, pcId: string): Promise<void> {
  for (;;) {
    await Bun.sleep(REPAIR_POLL_MS)
    const next = await loadConfig(dir).catch(() => null)
    if (next && next.pcId !== pcId) return
  }
}

async function redetect(dir: string, log: Logger, live: LiveCaps, current: () => Detection): Promise<Detection | null> {
  try {
    const next = await detect(dir, log, live)
    const previous = current()
    if (previous.driver && previous.driver !== next.driver) void previous.driver.close().catch(() => undefined)
    return next
  } catch (error) {
    log.warn(`could not recheck this machine: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function warnOnLooseKey(dir: string, log: Logger): Promise<void> {
  const mode = await stat(paths(dir).key).then(
    (info) => info.mode & 0o777,
    () => null,
  )
  if (mode !== null && mode !== 0o600) log.warn(`${paths(dir).key} is mode ${mode.toString(8)}; it must be 0600`)
}

export type Check = { name: string; ok: boolean; detail: string }

export async function diagnose(dir = configDir()): Promise<{ checks: Check[]; detection: Detection | null }> {
  const log = createLogger("kiko-computer", paths(dir).log)
  const checks: Check[] = []
  const config = await loadConfig(dir)
  const key = await loadKey(dir)
  checks.push({
    name: "config",
    ok: config !== null,
    detail: config ? `${config.name} (${config.pcId}) for ${config.url}` : "not paired",
  })
  checks.push({ name: "key", ok: key !== null, detail: key ? "Ed25519 private key present" : "key.jwk is missing" })
  const mode = await stat(paths(dir).key).then(
    (info) => info.mode & 0o777,
    () => null,
  )
  if (mode !== null) checks.push({ name: "key mode", ok: mode === 0o600, detail: mode.toString(8) })
  const policy = await loadPolicy(dir)
  checks.push({
    name: "policy",
    ok: true,
    detail: `shell ${policy.shell ? "on" : "off"}, desktop ${policy.desktop ? "on" : "off"}, files ${policy.files.allow.join(", ")}`,
  })
  const detection = await detect(dir, log)
  checks.push({
    name: "desktop",
    ok: true,
    detail: detection.caps.desktop
      ? `${detection.driverPath ?? "cua-driver"}, ${detection.displays.length} display(s)`
      : "off; shell and files still work",
  })
  checks.push({ name: "ffmpeg", ok: true, detail: Bun.which("ffmpeg") ?? "not installed; live video is off" })
  checks.push({
    name: "shell",
    ok: true,
    detail: process.platform === "win32" ? "powershell -NoProfile -Command" : "/bin/sh -lc",
  })
  if (config) checks.push(await reachable(config.url))
  return { checks, detection }
}

async function reachable(base: string): Promise<Check> {
  const url = new URL("api/health", base.endsWith("/") ? base : `${base}/`)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return { name: "worker", ok: response.ok, detail: `${url.origin} answered ${response.status}` }
  } catch (error) {
    return {
      name: "worker",
      ok: false,
      detail: `${url.origin} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
