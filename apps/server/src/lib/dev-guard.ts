import { devSession } from "../auth/dev-session"
import type { Env } from "../index"
import { type DevCounterPort, patchStorage } from "./dev-stats-patch"

// The one module that reads NODE_ENV. Bundling substitutes the literal and folds only a comparison written
// here, in the same statement, so each dev-only branch sits on `process.env.NODE_ENV === "development"`.
// A `DEV` const does not fold: the bundler substitutes the literal but does not propagate the constant to
// another statement, and a `DEV ? x : y` then leaves x in a production bundle. Everything reachable only
// from a folded branch is dropped with it.
declare const process: { env: { NODE_ENV?: string } }

export const DEV = process.env.NODE_ENV === "development"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function devAuthPlugins() {
  return process.env.NODE_ENV === "development" ? [devSession()] : []
}

export function devTrustedOrigins(): string[] {
  return DEV ? ["http://localhost:*"] : []
}

type DevModules = {
  routes: typeof import("./dev-routes")
  room: typeof import("../room/dev-impl")
  user: typeof import("../user/dev-impl")
  agent: typeof import("../agent/dev-impl")
}

// The one fold for every dev module. A production build substitutes the literal and returns null, so the
// switch is unreachable and none of these imports enter the bundle. The specifiers stay literal so the
// bundler can resolve them in a dev build.
function devModule(name: keyof DevModules): Promise<unknown> | null {
  if (process.env.NODE_ENV !== "development") return null
  switch (name) {
    case "routes":
      return import("./dev-routes")
    case "room":
      return import("../room/dev-impl")
    case "user":
      return import("../user/dev-impl")
    case "agent":
      return import("../agent/dev-impl")
  }
}

// Route guard: the Worker asks this first. Outside a dev build it answers null, as if no dev route existed.
export async function devResponse(request: Request, env: Env): Promise<Response | null> {
  const mod = (await devModule("routes")) as DevModules["routes"] | null
  return mod ? mod.devRoutes(request, env) : null
}

// For one dev route request: answers only to a local host.
export function devRequest(url: URL): boolean {
  return DEV && LOCAL_HOSTS.has(url.hostname)
}

// The single guarded entry for the dev-only methods of each Durable Object. The facade in
// room/dev.ts, user/dev.ts, agent/agent-do.ts reaches its body through one of these, and each dev
// method body lives in the `-impl` module the fold drops. Outside a dev build the load throws, as if
// the method did not exist.
export function loadRoomDev(): Promise<DevModules["room"]> {
  return (devModule("room") as Promise<DevModules["room"]> | null) ?? devMissing()
}

export function loadUserDev(): Promise<DevModules["user"]> {
  return (devModule("user") as Promise<DevModules["user"]> | null) ?? devMissing()
}

export function loadAgentDev(): Promise<DevModules["agent"]> {
  return (devModule("agent") as Promise<DevModules["agent"]> | null) ?? devMissing()
}

// The storage patch behind the dev counters, synchronous so it lands before an object's first query.
export function instrumentDev(ctx: DurableObjectState, kind: string, port: DevCounterPort): void {
  if (process.env.NODE_ENV === "development") patchStorage(ctx, kind, port)
}

function devMissing(): never {
  throw new Error("not found")
}
