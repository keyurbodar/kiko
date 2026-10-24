import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { openAvatarPicker } from "../../avatar/picker-state"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { THINKING_LABELS } from "@kiko/protocol"
import { canReason } from "../../settings/agent-model"
import { DangerRow, Profile, Properties, Property, roomMembers } from "../info/sections"
import { SoulCard } from "../info/soul"

const sentence = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function AgentPage(props: { slug: string; chatId: string; onRemoved: () => void }) {
  const member = () => roomMembers().find((m) => m.slug === props.slug)
  const picked = () => user.agentModel(props.slug)
  const status = () => room.status()[props.slug as never] ?? "idle"
  return (
    <div class="flex min-h-full flex-col" data-component="info-agent" data-slug={props.slug}>
      <Profile
        face={
          <button
            type="button"
            class="rounded-full outline-none"
            aria-label="Change avatar"
            title="Change avatar"
            data-action="change-avatar"
            onClick={() => openAvatarPicker(props.slug)}
          >
            <IdentityAvatar seed={props.slug} size={56} />
          </button>
        }
      >
        <h2 class="type-row text-fg">{member()?.name ?? props.slug}</h2>
      </Profile>
      <Properties>
        <Property label="Role" field="role">
          {member()?.lead ? "Lead" : "Agent"}
        </Property>
        <Property label="Model" field="model">
          {picked()?.model.split("/").slice(1).join("/") ?? "None"}
        </Property>
        {canReason(picked()?.thinkingLevels) && (
          <Property label="Reasoning" field="thinking">
            {THINKING_LABELS[picked()!.thinking]}
          </Property>
        )}
        <Property label="Status" field="status">
          {sentence(status())}
        </Property>
      </Properties>
      <div class="px-2 pb-4">
        <SoulCard slug={props.slug} />
      </div>
      {member() && roomMembers().length > 1 && (
        <DangerRow
          action="remove-agent"
          label="Remove from chat"
          description="It leaves this chat. Its soul and memory stay."
          onClick={() => {
            room.memberOp({ op: "remove", slug: props.slug as never })
            props.onRemoved()
          }}
        />
      )}
    </div>
  )
}
