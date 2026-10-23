import type { Agent, AgentSlug, RoomId } from "@kiko/protocol"
import { newRoomId } from "@kiko/protocol"
import type { AvatarPins } from "@kiko/theme/look"
import { showFailure } from "../lib/errors"
import { attempt, owner } from "../state/runtime"
import { look, saveLook } from "../theme/live"
import { type Form, tidyName } from "./model"

export function createAgent(form: Form, pins: AvatarPins, back: () => void): RoomId | null {
  const slug = form.handle.trim().replace(/^@/, "") as AgentSlug
  const description = form.description.trim()
  const agent: Agent = {
    id: crypto.randomUUID(),
    name: tidyName(form.name),
    slug,
    prompt: description.slice(0, 200),
    model: "",
  }
  const roomId = newRoomId()
  const before = look()
  if (Object.keys(pins).length) saveLook({ ...before, avatars: { ...before.avatars, [slug]: pins } })
  void attempt(
    owner.commands.createAgent,
    { agent, roomId, description },
    (error) => {
      saveLook({ ...look(), avatars: before.avatars })
      back()
      showFailure(error)
    },
    "Kiko could not make the agent. Try again.",
  )
  return roomId
}
