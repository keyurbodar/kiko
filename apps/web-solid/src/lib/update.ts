import type { SupervisorConnectionPhase } from "@kiko/client-runtime/connection"
import { speaksRpc, type UpdateStage, type UserToClient } from "@kiko/protocol"
import { type BackendBuild, backendSkew, type Build, clientBehind, type Skew } from "./version-skew"

export type UpdateProgress = { stage: UpdateStage; error?: string; sentAt?: number } | null

export const STALL_MS = 20_000
const STALL_ERROR = "This backend cannot update itself. Reconnect Cloudflare to reinstall it."

export const sent = (now: number): UpdateProgress => ({ stage: "checking", sentAt: now })

export function checkStall(progress: UpdateProgress, now: number): UpdateProgress {
  if (progress?.sentAt === undefined || now - progress.sentAt < STALL_MS) return progress
  return { stage: "failed", error: STALL_ERROR }
}

const STAGE_TEXT: Record<Exclude<UpdateStage, "failed">, string> = {
  checking: "Checking the release",
  authorizing: "Authorizing",
  uploading: "Uploading",
  restarting: "Restarting",
}

type StateFrame = Extract<UserToClient, { t: "update.state" }>

export function reduceUpdate(frame: StateFrame): UpdateProgress {
  return frame.stage === "failed"
    ? { stage: "failed", error: frame.error ?? "The update failed. Try again." }
    : { stage: frame.stage }
}

function stageText(progress: UpdateProgress): string | undefined {
  return progress && progress.stage !== "failed" ? STAGE_TEXT[progress.stage] : undefined
}

export type PillView =
  | { kind: "none" }
  | { kind: "busy"; text: string }
  | { kind: "failed"; error: string }
  | { kind: "update"; blocked: boolean }

export function pillView(skew: Skew | undefined, clientIsBehind: boolean, progress: UpdateProgress): PillView {
  const text = stageText(progress)
  if (text) return { kind: "busy", text }
  if (progress?.stage === "failed") return { kind: "failed", error: progress.error ?? "The update failed. Try again." }
  if (skew === "blocked") return { kind: "update", blocked: true }
  if (clientIsBehind || skew === "update") return { kind: "update", blocked: false }
  return { kind: "none" }
}

export const updateTarget = (app: string, latest: string | undefined): string =>
  clientBehind(app, latest) ? (latest as string) : app

export const RESTART_POLL_MS = 2_000
export const RESTART_LIMIT_MS = 180_000
export const RESTART_ERROR = "Kiko was updated but has not restarted yet. Wait a minute, then try again."

export const landed = (target: string, backend: string | undefined): boolean =>
  backend !== undefined && !clientBehind(backend, target)

export type RestartStep = "wait" | "reconnect" | "done"

const RECONNECTABLE: ReadonlySet<SupervisorConnectionPhase | undefined> = new Set(["backoff", "blocked", "available"])

export function restartStep(
  target: string,
  build: BackendBuild | null,
  phase: SupervisorConnectionPhase | undefined,
): RestartStep {
  if (!build || !speaksRpc(build) || !landed(target, build.version)) return "wait"
  if (phase === "connected") return "done"
  return RECONNECTABLE.has(phase) ? "reconnect" : "wait"
}

export const autoUpdateKey = (client: Build, backend: BackendBuild | null): string | null =>
  backend?.version !== undefined && backendSkew(client, backend) === "update"
    ? `${backend.version}->${client.version}`
    : null

export const LATEST_POLL_MS = 5 * 60_000
