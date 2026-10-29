import type { Room } from "../room/room-do"
import type { User } from "../user/user-do"
import type { Agent } from "../agent/agent-do"
import type { FileBucket } from "../files/store"
import type { ComputerHub } from "../computer/hub"

export interface OwnerServices {
  trimAgents(): Promise<void>
  countOutgoing(): void
  runShared(roomId: string, slug: string): AbortSignal | undefined
  user(): User
  room(roomId: string): Room
  agent(roomId: string, slug: string): Agent
  dispatchRun(roomId: string, slug: string): Promise<void>
  cancelRun(roomId: string, slug: string): Promise<void>
  afterRun(roomId: string, slug: string, human: boolean): Promise<void>
  syncRoutines(routines: readonly import("./schedules").ScheduledRoutine[]): Promise<void>
  fireRoutine(delivery: import("./schedules").RoutineDelivery): Promise<void>
  files(): FileBucket
  sweepUploads(before: number): number
  egress(request: Parameters<Agent["egress"]>[0]): ReturnType<Agent["egress"]>
}

export interface Metadata {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export interface ServiceOptions {
  identity: { ownerId: string; roomId?: string; slug?: string }
  metadata: Metadata
  clock: import("@kiko/durable/clock-port").ClockPort
  ctx: DurableObjectState
  sql: SqlStorage
  env: import("../index").Env
  services: OwnerServices
  computers: ComputerHub
  broadcast(frame: unknown): void
}
