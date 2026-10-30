export function selfArgv(): string[] {
  const exec = process.execPath
  if (Bun.main.includes("$bunfs") || /kiko-computer/.test(exec)) return [exec]
  return [exec, Bun.main]
}
