import { devSession } from "../auth/dev-session"
import type { Env } from "../index"

// The one module that reads NODE_ENV. Bundling folds `process.env.NODE_ENV === "development" ? x : y` only
// inside one module, so each dev-only reference sits in such a ternary here. A production bundle then drops it.
declare const process: { env: { NODE_ENV?: string } }

export const DEV = process.env.NODE_ENV === "development"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function devAuthPlugins() {
  return process.env.NODE_ENV === "development" ? [devSession()] : []
}

export function devTrustedOrigins(): string[] {
  return process.env.NODE_ENV === "development" ? ["http://localhost:*"] : []
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

// For a dev-only object method: throws as if the method did not exist.
export function devOnly(): void {
  if (!DEV) throw new Error("not found")
}
