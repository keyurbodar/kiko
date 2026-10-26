import * as Schema from "effect/Schema"
import { type UserId } from "@kiko/protocol"
import type { OwnerDO } from "../owner/owner-do"
import { rpc } from "./dev-guard"

export const USER_ID_HEADER = "x-kiko-user-id"
export const HANDLE_HEADER = "x-kiko-handle"
export const ROOM_ID_HEADER = "x-kiko-room-id"

export class NameError extends Schema.TaggedError<NameError>()("NameError", {
  message: Schema.String,
}) {}

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function checkUser(userId: string): UserId {
  if (!USER_ID_PATTERN.test(userId)) throw new NameError({ message: "bad user id" })
  return userId as UserId
}

export async function composioUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`composio:${checkUser(userId)}`))
  return `kiko_${[...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)}`
}

function ownerName(userId: string): string {
  const id = checkUser(userId)
  return id === "owner" ? "owner" : `owner:${id}`
}

type OwnerRpc = Omit<DurableObjectStub<OwnerDO>, "userCall" | "roomCall" | "agentCall"> &
  Pick<OwnerDO, "userCall" | "roomCall" | "agentCall">

export function ownerStub(ns: DurableObjectNamespace<OwnerDO>, userId: string): OwnerRpc {
  return rpc(ns.get(ns.idFromName(ownerName(userId))), "owner") as OwnerRpc
}
