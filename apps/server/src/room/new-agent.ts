import type { Agent, RoomId } from "@kiko/protocol"
import { checkNewAgent, introduction, type Maker, type NewAgentSpec } from "./chief"
import type { RecipeHint } from "../recipes/match"

type NewAgentPorts = {
  agents(): Promise<readonly Agent[]>
  make(spec: NewAgentSpec & { id?: string }): Promise<Agent | null>
  openChat(title: string, agentIds: readonly string[], roomId?: RoomId): Promise<{ roomId: RoomId }>
  recipes(description: string): Promise<RecipeHint[]>
  introduce(roomId: RoomId, agent: Agent, text: string): Promise<void>
}

type NewAgentResult =
  | { ok: true; agent: Agent; roomId: RoomId;  introduced: Promise<void> }
  | { ok: false; error: string }

export async function makeAgentChat(p: NewAgentPorts, spec: NewAgentSpec, by: Maker, ids: { id?: string; roomId?: RoomId } = {}): Promise<NewAgentResult> {
  const mine = await p.agents()
  const again = ids.id ? mine.find((a) => a.id === ids.id) : undefined
  if (again) return { ok: true, agent: again, roomId: (await p.openChat(again.name, [again.id], ids.roomId)).roomId, introduced: Promise.resolve() }
  const checked = checkNewAgent(spec, mine)
  if ("error" in checked) return { ok: false, error: checked.error }
  const agent = await p.make({ ...checked, ...(ids.id ? { id: ids.id } : {}) })
  if (!agent) return { ok: false, error: `@${checked.handle} could not be made (the handle may be taken)` }
  const { roomId } = await p.openChat(agent.name, [agent.id], ids.roomId)
  const introduced = p
    .recipes(checked.description)
    .catch((): RecipeHint[] => [])
    .then((recipes) => p.introduce(roomId, agent, introduction(checked, by, recipes)))
    .catch((e: unknown) => console.error(`introduce failed: ${e instanceof Error ? e.message : String(e)}`))
  return { ok: true, agent, roomId, introduced }
}
