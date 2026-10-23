import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

export function findBinary(name: string, configDir?: string): string | null {
  const exe = process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name
  if (configDir) {
    const local = join(configDir, exe)
    if (existsSync(local)) return local
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function probeEncoders(ffmpeg: string): string[] {
  const result = Bun.spawnSync([ffmpeg, "-hide_banner", "-encoders"], { stdout: "pipe", stderr: "pipe" })
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => /^\s*V\S*\s+(\S+)/.exec(line)?.[1])
    .filter((name): name is string => typeof name === "string")
}
