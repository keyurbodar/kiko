import { devSession } from "../auth/dev-session"
import type { Env } from "../index"
import { type DevCounterPort, patchStorage } from "./dev-stats-patch"

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

// The single guarded entry for the dev-only methods of each Durable Object. The facade in room/dev.ts,
// user/dev.ts, and agent/agent-do.ts reaches its bodies through one of these, and each body lives in the
// `-impl` module the fold drops. Outside a dev build the load throws, as if the method did not exist.
export function loadRoomDev(): Promise<typeof import("../room/dev-impl")> {
  return process.env.NODE_ENV === "development" ? import("../room/dev-impl") : devMissing()
}

export function loadUserDev(): Promise<typeof import("../user/dev-impl")> {
  return process.env.NODE_ENV === "development" ? import("../user/dev-impl") : devMissing()
}

export function loadAgentDev(): Promise<typeof import("../agent/dev-impl")> {
  return process.env.NODE_ENV === "development" ? import("../agent/dev-impl") : devMissing()
}

// The storage patch behind the dev counters, synchronous so it lands before an object's first query.
export function instrumentDev(ctx: DurableObjectState, kind: string, port: DevCounterPort): void {
  if (process.env.NODE_ENV === "development") patchStorage(ctx, kind, port)
}

function devMissing(): never {
  throw new Error("not found")
}
