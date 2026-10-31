import { stat } from "node:fs/promises"
import { PROTOCOL, type Holder } from "@kiko/computer/wire"
import { createBrowserLink } from "./browser/link"
import { detect, type Detection } from "./caps"
import { configDir, loadConfig, loadKey, loadPolicy, paths, pausedCache, policyCache } from "./config"
import { runLink, type Host } from "./connection"
import { startDriver, type Driver } from "./driver"
import { helloPayload } from "./hello"
import { emptyLive, startLive, type Live, type LiveCaps } from "./live"
import { createFeed } from "./feed"
import { createLogger, type Logger } from "./log"
import { VERSION } from "./platform"
import { hasPty } from "./terminal/pty"
import { TerminalManager } from "./terminal/manager"
import { createTerminalLink } from "./terminal/link"
import { createUpdater, updateTarget, type Updater } from "./update"

const REPAIR_POLL_MS = 30_000
const DOCTOR_WAIT_MS = 3_000
const WELCOMED = "the worker calls this machine"

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
  const feed = createFeed({ state: paths(dir).state, agent: paths(dir).agent })
  void feed.connected(null)
  let holder: Holder = "agent"
  const setHolder = (next: Holder) => {
    holder = next
    log.info(next === "human" ? "the owner took control of this screen" : "the owner handed this screen back")
  }
  const policy = await loadPolicy(dir)
  const policies = policyCache(dir)
  const paused = pausedCache(dir)
  let link: ReturnType<typeof runLink> | null = null
  let live: Live = emptyLive({ logger: log, setHolder, send: (frame) => link?.frame(frame) })
  let driver: Driver | null = null
  let detection = detect(log, policy, null, dir)
  let liveCaps: LiveCaps = policy
  let liveStarting = false
  let update: Updater | null = null
  const terminals = new TerminalManager()
  const terminalLink = createTerminalLink({
    manager: () => (hasPty() ? terminals : null),
    holder: () => holder,
    send: (frame) => link?.frame(frame),
  })
  const browserLink = createBrowserLink({
    driver: () => driver,
    holder: () => holder,
    send: (frame) => link?.frame(frame),
    sendBinary: (bytes) => link?.binary(bytes),
    warn: (message) => log.warn(message),
  })
  const refresh = () => {
    detection = detect(log, liveCaps, driver?.state() ?? null, dir)
    link?.reconnect()
  }
  const startLiveWhenReady = () => {
    if (liveStarting || !detection.caps.live) return
    liveStarting = true
    void startLive({
      logger: log,
      setHolder,
      send: (frame) => link?.frame(frame),
      sendBinary: (bytes) => link?.binary(bytes),
      policy: () => policies.current(),
      display: () => detection.displays[0],
      configDir: dir,
    }).then((started) => {
      live = started
      liveCaps = { live: started.live, input: started.input }
      refresh()
    })
  }
  const updated = () => {
    refresh()
    startLiveWhenReady()
  }
  const host: Host = {
    endpoint: { url: config.url, userId: config.userId, pcId: config.pcId, protocol: PROTOCOL },
    key,
    hello: () => JSON.stringify(helloPayload(detection, driver)),
    policy: policies.get,
    driver: () => driver,
    terminal: () => (hasPty() ? terminals : null),
    terminals: terminalLink,
    browser: browserLink,
    paused,
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
      void feed.connected(name)
      update?.offer(version)
    },
    onOffline: () => void feed.connected(null),
    onIdle: () => {
      void feed.working(null)
      update?.idle()
    },
  }
  const driverPath = process.env.KIKO_DRIVER
  if (driverPath) driver = startDriver({ path: driverPath, log, onChange: updated })
  updated()
  link = runLink(host)
  const shutdown = () => {
    log.info("stopping")
    link?.stop()
    driver?.close()
    terminalLink.close()
    browserLink.close()
    terminals.closeAll()
    void live.close()
    process.exit(0)
  }
  update = createUpdater({
    log,
    origin: config.url,
    running: VERSION,
    target: updateTarget(process.env),
    busy: () => link?.busy() ?? false,
    restart: shutdown,
  })
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  log.info(
    `${config.name} connecting to ${config.url} with ${detection.caps.desktop ? "desktop tools" : "shell and files only"}`,
  )
  try {
    await link.loop()
  } finally {
    driver?.close()
  }
  if (!link.removed) return 0
  await live.close()
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
  const driver = await reachDriver(log)
  const detection = detect(log, { live: false, input: false }, driver?.state() ?? null, dir)
  driver?.close()
  checks.push({ name: "desktop", ok: desktopOk(detection), detail: desktopDetail(detection) })
  checks.push({ name: "ffmpeg", ok: true, detail: Bun.which("ffmpeg") ?? "not installed; live video is off" })
  checks.push({
    name: "shell",
    ok: true,
    detail: process.platform === "win32" ? "powershell -NoProfile -Command" : "/bin/sh -lc",
  })
  checks.push({
    name: "terminal",
    ok: hasPty(),
    detail: hasPty() ? "terminal sessions are available" : "this Bun build has no pseudo-terminal support",
  })
  if (config) checks.push(await reachable(config.url))
  return { checks, detection }
}

async function reachDriver(log: Logger): Promise<Driver | null> {
  const path = process.env.KIKO_DRIVER
  if (!path) return null
  let driver: Driver | null = null
  const ready = new Promise<void>((resolve) => {
    driver = startDriver({
      path,
      log,
      onChange: () => {
        if (driver?.state()) resolve()
      },
    })
  })
  await Promise.race([ready, Bun.sleep(DOCTOR_WAIT_MS)])
  return driver
}

function desktopOk(detection: Detection): boolean {
  if (!detection.caps.desktop) return false
  return detection.access === null || (detection.access.screen && detection.access.input)
}

function desktopDetail(detection: Detection): string {
  if (!detection.caps.desktop) return `${detection.reason ?? "desktop tools are off"}; shell and files still work`
  const access = detection.access
  if (!access) return "the desktop engine is running"
  const missing: string[] = []
  if (!access.screen) missing.push(`screen recording: ${screenFix()}`)
  if (!access.input) missing.push(`input: ${inputFix()}`)
  if (missing.length > 0) return missing.join("; ")
  return `${detection.displays.length} display(s); screen recording and input are allowed`
}

function screenFix(): string {
  return process.platform === "darwin"
    ? "open System Settings > Privacy & Security > Screen Recording and turn on kiko"
    : "allow screen recording for kiko"
}

function inputFix(): string {
  return process.platform === "darwin"
    ? "open System Settings > Privacy & Security > Accessibility and turn on kiko"
    : "allow input control for kiko"
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
