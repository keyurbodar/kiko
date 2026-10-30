import { stat } from "node:fs/promises"
import { PROTOCOL, type Holder } from "@kiko/computer/wire"
import { detect, type Detection } from "./caps"
import { configDir, loadConfig, loadKey, loadPolicy, paths } from "./config"
import { runLink, type Host } from "./connection"
import { helloPayload } from "./hello"
import { emptyLive, startLive, type Live } from "./live"
import { createLogger, type Logger } from "./log"
import { VERSION } from "./platform"
import { createUpdater, updateTarget, type Updater } from "./update"

const REPAIR_POLL_MS = 30_000
const ACCESS_POLL_MS = 30_000
export const WELCOMED = "the worker calls this machine"

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
  let detection = detect(log, policy)
  if (policy.desktop) detection.backend?.requestAccess()
  let update: Updater | null = null
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
    onWelcome: (name, version) => {
      log.info(`${WELCOMED} ${name}`)
      update?.offer(version)
    },
    onIdle: () => update?.idle(),
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
    detection.backend?.close()
    process.exit(0)
  }
  update = createUpdater({
    log,
    origin: config.url,
    running: VERSION,
    target: updateTarget(process.execPath, process.platform, process.env),
    busy: () => link.busy(),
    restart: shutdown,
  })
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  log.info(
    `${config.name} connecting to ${config.url} with ${detection.caps.desktop ? "desktop tools" : "shell and files only"}`,
  )
  const access = setInterval(() => {
    const backend = detection.backend
    if (!backend) return
    const next = backend.access()
    const current = detection.access
    const granted = next.screen && next.input
    if (current && current.screen === next.screen && current.input === next.input) {
      if (granted) clearInterval(access)
      return
    }
    detection = { ...detection, access: next }
    if (granted) clearInterval(access)
    link.reconnect()
  }, ACCESS_POLL_MS)
  try {
    await link.loop()
  } finally {
    clearInterval(access)
  }
  if (!link.removed) return 0
  await live.close()
  detection.backend?.close()
  await repaired(dir, config.pcId)
  log.info("paired again; restarting")
  return 0
}

async function repaired(dir: string, pcId: string): Promise<void> {
  for (;;) {
    const next = await loadConfig(dir).catch(() => null)
    if (next && next.pcId !== pcId) return
    await Bun.sleep(REPAIR_POLL_MS)
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
  const detection = detect(log)
  checks.push({ name: "desktop", ok: desktopOk(detection), detail: desktopDetail(detection) })
  checks.push({ name: "ffmpeg", ok: true, detail: Bun.which("ffmpeg") ?? "not installed; live video is off" })
  checks.push({
    name: "shell",
    ok: true,
    detail: process.platform === "win32" ? "powershell -NoProfile -Command" : "/bin/sh -lc",
  })
  if (config) checks.push(await reachable(config.url))
  return { checks, detection }
}

function desktopOk(detection: Detection): boolean {
  if (!detection.caps.desktop) return false
  return detection.access === null || (detection.access.screen && detection.access.input)
}

function desktopDetail(detection: Detection): string {
  if (!detection.caps.desktop) return `${detection.reason ?? "desktop tools are off"}; shell and files still work`
  const access = detection.access
  if (!access) return "the desktop backend is running"
  const missing: string[] = []
  if (!access.screen) missing.push(`screen recording: ${screenFix()}`)
  if (!access.input) missing.push(`input: ${inputFix()}`)
  if (missing.length > 0) return missing.join("; ")
  return `${detection.displays.length} display(s); screen recording and input are allowed`
}

function screenFix(): string {
  return process.platform === "darwin"
    ? "open System Settings > Privacy & Security > Screen Recording and turn on kiko-computer-host"
    : "allow screen recording for kiko-computer-host"
}

function inputFix(): string {
  return process.platform === "darwin"
    ? "open System Settings > Privacy & Security > Accessibility and turn on kiko-computer-host"
    : "allow input control for kiko-computer-host"
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
