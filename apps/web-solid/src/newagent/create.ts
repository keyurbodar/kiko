import type { Agent, AgentSlug, RoomId } from "@kiko/protocol"
import { newRoomId } from "@kiko/protocol"
import type { AvatarPins } from "@kiko/theme/look"
import { apiFetch } from "../lib/api"
import { showFailure } from "../lib/errors"
import { useApp } from "../lib/store"
import { look, saveLook } from "../theme/live"
import { type Form, tidyName } from "./model"

/**
 * Makes the agent. Its chat, its avatar, and its place in the list are in at once; the server then makes the
 * agent and starts its greeting. If the server refuses, all of it is taken back and the person is told why.
 * Returns the chat to open.
 */
export function createAgent(form: Form, pins: AvatarPins, back: () => void): RoomId | null {
  const user = useApp.user()
  if (!user) return null
  const slug = form.handle.trim().replace(/^@/, "") as AgentSlug
  const description = form.description.trim()
  const agent: Agent = { id: crypto.randomUUID(), name: tidyName(form.name), slug, prompt: description.slice(0, 200), model: "" }
  const roomId = newRoomId()
  const undo = user.addAgentChat(agent, roomId)
  const before = look()
  saveLook({ ...before, avatars: { ...before.avatars, [slug]: pins } })
  void send(agent, roomId, description).then((error) => {
    if (error === null) return
    undo()
    saveLook({ ...look(), avatars: before.avatars })
    back()
    showFailure(error)
  })
  return roomId
}

async function send(agent: Agent, roomId: RoomId, description: string): Promise<string | null> {
  const res = await apiFetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: agent.id, roomId, name: agent.name, handle: agent.slug, description }),
  }).catch(() => null)
  if (res?.ok) return null
  const body = (await res?.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? "Kiko could not make the agent. Try again."
}
