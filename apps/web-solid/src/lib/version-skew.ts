declare const __KIKO_VERSION__: string | undefined
export const APP_VERSION: string = typeof __KIKO_VERSION__ === "string" ? __KIKO_VERSION__ : "0.0.0"

export type Skew = "ok" | "update" | "blocked"

const core = (version: string) => (version.split(/[-+]/)[0] ?? "").split(".").map(Number)

export function olderThan(version: string, than: string): boolean {
  const a = core(version)
  const b = core(than)
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

export const clientBehind = (client: string, latest: string | undefined): boolean =>
  latest !== undefined && olderThan(client, latest)
