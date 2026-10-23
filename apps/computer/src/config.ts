import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homeDir } from "./platform"

export type Config = { url: string; userId: string; pcId: string; name: string }

export type Policy = {
  shell: boolean
  files: { allow: string[] }
  desktop: boolean
  live: boolean
  input: boolean
}

const DEFAULT_POLICY: Policy = {
  shell: true,
  files: { allow: ["~"] },
  desktop: true,
  live: true,
  input: true,
}

export type Paths = {
  dir: string
  config: string
  key: string
  policy: string
  log: string
}

export function configDir(): string {
  const override = process.env.KIKO_COMPUTER_DIR
  if (override) return override
  if (process.platform === "darwin") return join(homeDir(), "Library", "Application Support", "kiko-computer")
  if (process.platform === "win32")
    return join(process.env.APPDATA ?? join(homeDir(), "AppData", "Roaming"), "kiko-computer")
  return join(process.env.XDG_CONFIG_HOME ?? join(homeDir(), ".config"), "kiko-computer")
}

export function paths(dir = configDir()): Paths {
  return {
    dir,
    config: join(dir, "config.json"),
    key: join(dir, "key.jwk"),
    policy: join(dir, "policy.json"),
    log: join(dir, "daemon.log"),
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return null
  }
}

const privateFile = { mode: 0o600 } as const

async function writePrivate(file: string, body: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, privateFile)
  await chmod(file, 0o600)
}

function asConfig(value: unknown): Config | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const url = record.url
  const userId = record.userId
  const pcId = record.pcId
  const name = record.name
  if (typeof url !== "string" || typeof userId !== "string" || typeof pcId !== "string") return null
  return { url, userId, pcId, name: typeof name === "string" ? name : "computer" }
}

export async function loadConfig(dir = configDir()): Promise<Config | null> {
  return asConfig(await readJson(paths(dir).config))
}

export async function saveConfig(dir: string, config: Config): Promise<void> {
  await writePrivate(paths(dir).config, config)
}

export async function loadKey(dir = configDir()): Promise<JsonWebKey | null> {
  const value = await readJson(paths(dir).key)
  if (typeof value !== "object" || value === null) return null
  const key = value as JsonWebKey
  return typeof key.d === "string" && key.crv === "Ed25519" ? key : null
}

export async function saveKey(dir: string, key: JsonWebKey): Promise<void> {
  await writePrivate(paths(dir).key, key)
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === "string")
}

function mergePolicy(raw: unknown): Policy {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const files =
    typeof record.files === "object" && record.files !== null ? (record.files as Record<string, unknown>) : {}
  const allow = strings(files.allow)
  return {
    shell: typeof record.shell === "boolean" ? record.shell : DEFAULT_POLICY.shell,
    files: { allow: allow ?? [...DEFAULT_POLICY.files.allow] },
    desktop: typeof record.desktop === "boolean" ? record.desktop : DEFAULT_POLICY.desktop,
    live: typeof record.live === "boolean" ? record.live : DEFAULT_POLICY.live,
    input: typeof record.input === "boolean" ? record.input : DEFAULT_POLICY.input,
  }
}

export async function loadPolicy(dir = configDir()): Promise<Policy> {
  return mergePolicy(await readJson(paths(dir).policy))
}

export async function ensurePolicy(dir: string): Promise<void> {
  if ((await readJson(paths(dir).policy)) !== null) return
  await mkdir(dir, { recursive: true })
  await writeFile(paths(dir).policy, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`)
}
