import type { Env } from "../index"
import { bump, port, proxyRpc, trackInFlight } from "./dev-stats"
import { patchStorage } from "./dev-stats-patch"

declare const process: { env: { NODE_ENV?: string } }

export const DEV = process.env.NODE_ENV === "development"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devResponse(request: Request, env: Env): Promise<Response | null> {
  return process.env.NODE_ENV === "development" ? (await import("./dev-routes")).devRoutes(request, env) : null
}

export function devRequest(url: URL): boolean {
  return DEV && LOCAL_HOSTS.has(url.hostname)
}

export function loadRoomDev(): Promise<typeof import("../room/dev")> {
  return process.env.NODE_ENV === "development" ? import("../room/dev") : devMissing()
}

export function loadUserDev(): Promise<typeof import("../user/dev")> {
  return process.env.NODE_ENV === "development" ? import("../user/dev") : devMissing()
}

export function loadAgentDev(): Promise<typeof import("../agent/dev")> {
  return process.env.NODE_ENV === "development" ? import("../agent/dev") : devMissing()
}

export function instrument(ctx: DurableObjectState, kind: string): void {
  if (process.env.NODE_ENV === "development") patchStorage(ctx, kind, port)
}

export function count(key: string, n = 1): void {
  if (process.env.NODE_ENV === "development") bump(key, n)
}

export function rpc<T extends object>(stub: T, target: string): T {
  return process.env.NODE_ENV === "development" ? proxyRpc(stub, target) : stub
}

export function devOverride<T>(read: () => T | null): T | null {
  return process.env.NODE_ENV === "development" ? read() : null
}

export function inFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  return process.env.NODE_ENV === "development" ? trackInFlight(key, run) : run()
}

function devMissing(): never {
  throw new Error("not found")
}
