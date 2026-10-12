import { devSession } from "../auth/dev-session"
import type { Env } from "../index"
import { bump, port, proxyRpc, trackInFlight } from "./dev-stats"
import { patchStorage } from "./dev-stats-patch"

// The one module that reads NODE_ENV. Bundling substitutes the literal and folds only a comparison written
// here, in the same statement, so each dev-only branch sits on `process.env.NODE_ENV === "development"`.
// A `DEV` const does not fold: the bundler substitutes the literal but does not propagate the constant to
// another statement, and a `DEV ? x : y` then leaves x in a production bundle. A shared loader does not
// fold either: the import must sit in the folded branch itself, so each dev module gets its own ternary.
// Everything reachable only from a folded branch is dropped with it.
declare const process: { env: { NODE_ENV?: string } }

export const DEV = process.env.NODE_ENV === "development"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function devAuthPlugins() {
  return process.env.NODE_ENV === "development" ? [devSession()] : []
}

export function devTrustedOrigins(): string[] {
  return DEV ? ["http://localhost:*"] : []
}

// Route guard: the Worker asks this first. Outside a dev build it answers null, as if no dev route existed.
// The routes load by dynamic import so that a production bundle never reaches their modules.
export async function devResponse(request: Request, env: Env): Promise<Response | null> {
  return process.env.NODE_ENV === "development" ? (await import("./dev-routes")).devRoutes(request, env) : null
}

// For one dev route request: answers only to a local host.
export function devRequest(url: URL): boolean {
  return DEV && LOCAL_HOSTS.has(url.hostname)
}

// The single guarded entry for the dev-only methods of each Durable Object. Each DO holds its own lazily
// loaded dev module through one of these, and the bodies live in room/dev.ts, user/dev.ts, and
// agent/dev.ts, the modules the fold drops. Outside a dev build the load throws, as if the method did not exist.
export function loadRoomDev(): Promise<typeof import("../room/dev")> {
  return process.env.NODE_ENV === "development" ? import("../room/dev") : devMissing()
}

export function loadUserDev(): Promise<typeof import("../user/dev")> {
  return process.env.NODE_ENV === "development" ? import("../user/dev") : devMissing()
}

export function loadAgentDev(): Promise<typeof import("../agent/dev")> {
  return process.env.NODE_ENV === "development" ? import("../agent/dev") : devMissing()
}

// The storage patch behind the dev counters, synchronous so it lands before an object's first query.
export function instrument(ctx: DurableObjectState, kind: string): void {
  if (process.env.NODE_ENV === "development") patchStorage(ctx, kind, port)
}

// Dev counters: each wrapper folds to a no-op in a production bundle, and dev-stats goes with it.
export function count(key: string, n = 1): void {
  if (process.env.NODE_ENV === "development") bump(key, n)
}

export function rpc<T extends object>(stub: T, target: string): T {
  return process.env.NODE_ENV === "development" ? proxyRpc(stub, target) : stub
}

export function inFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  return process.env.NODE_ENV === "development" ? trackInFlight(key, run) : run()
}

function devMissing(): never {
  throw new Error("not found")
}
