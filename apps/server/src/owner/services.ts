import type { Room } from "../room/room-do"
import type { User } from "../user/user-do"
import type { Agent } from "../agent/agent-do"
import type { FileBucket } from "../files/store"

export interface OwnerServices {
  trimAgents(): Promise<void>
  user(): User
  room(roomId: string): Room
  agent(roomId: string, slug: string): Agent
  dispatchRun(roomId: string, slug: string): Promise<void>
  afterRun(roomId: string, slug: string): Promise<void>
  files(): FileBucket
  egress(request: Parameters<Agent["egress"]>[0]): ReturnType<Agent["egress"]>
}

/** Explicit dependencies shared by the owner-local services. */
export interface ServiceOptions {
  ctx: DurableObjectState
  sql: SqlStorage
  env: import("../index").Env
  services: OwnerServices
  broadcast(frame: unknown): void
}
