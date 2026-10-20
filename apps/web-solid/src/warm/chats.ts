import type { Agent, AgentModel, Chat, RoomId } from "@kiko/protocol"
import type { UserPatch } from "../sync/patches"
import type { Home } from "../sync/user-store"
import type { Warm } from "./db"
import { clearDraft } from "./drafts"
import { clearRoom } from "./messages"

const USER_SEQ = "userSeq"
const AGENTS = "agents"
const HOME = "home"
const AGENT_MODELS = "agentModels"
const PENDING_CHATS = "pendingChats"

export function putChats(warm: Warm, chats: readonly Chat[]) {
	for (const c of chats) warm.put("chats", c.roomId, c)
}

export async function allChats(warm: Warm): Promise<Chat[]> {
	const chats = await warm.getAll<Chat>("chats")
	return chats.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function removeChat(warm: Warm, roomId: RoomId) {
	warm.delete("chats", roomId)
	clearRoom(warm, roomId)
	clearDraft(warm, roomId)
}

export function replaceChats(warm: Warm, chats: readonly Chat[], seq: number) {
	warm.clear("chats")
	putChats(warm, chats)
	setUserSeq(warm, seq)
}

export async function getUserSeq(warm: Warm): Promise<number> {
	return (await warm.get<number>("meta", USER_SEQ)) ?? 0
}

export function setUserSeq(warm: Warm, seq: number) {
	warm.put("meta", USER_SEQ, seq)
}

export const putAgents = (warm: Warm, agents: readonly Agent[]) => warm.put("meta", AGENTS, agents)

export async function allAgents(warm: Warm): Promise<Agent[]> {
	return [...((await warm.get<Agent[]>("meta", AGENTS)) ?? [])]
}

export const putHome = (warm: Warm, home: Home) => warm.put("meta", HOME, home)

export const getHome = (warm: Warm): Promise<Home | undefined> => warm.get<Home>("meta", HOME)

export const putPendingChats = (warm: Warm, patches: readonly UserPatch[]) => warm.put("meta", PENDING_CHATS, patches)

export async function getPendingChats(warm: Warm): Promise<UserPatch[]> {
	return [...((await warm.get<UserPatch[]>("meta", PENDING_CHATS)) ?? [])]
}

export const putAgentModels = (warm: Warm, models: Readonly<Record<string, AgentModel>>) => warm.put("meta", AGENT_MODELS, models)

export async function allAgentModels(warm: Warm): Promise<Record<string, AgentModel>> {
	return { ...((await warm.get<Record<string, AgentModel>>("meta", AGENT_MODELS)) ?? {}) }
}
