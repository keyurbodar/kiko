import { type Agent, KIKO } from "@kiko/protocol"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { For, Show, type JSX } from "solid-js"
import { openChat } from "../app/history"
import { groupTitle, roomFor } from "../chat/bot-picker-model"
import { addable, addOp } from "../chat/members/model"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { user } from "../state/user"

function addToChat(chatId: string, agent: Agent) {
  if (chatId !== user.kikoChatId()) return room.memberOp(addOp(agent))
  const roomId = user.createChat(groupTitle(["Kiko", agent.name]), roomFor([KIKO, agent.id]))
  if (roomId) openChat(roomId)
}

export function AddSomeoneItems(props: { chatId: string }): JSX.Element {
  const agents = () => addable(user.agents(), room.roomMembers())
  return (
    <MenuV2.Group>
      <MenuV2.GroupLabel class="px-2 pt-1.5 pb-1 type-hint text-fg3">Add to this chat</MenuV2.GroupLabel>
      <Show when={agents().length > 0} fallback={<MenuV2.Item disabled>No other agents</MenuV2.Item>}>
        <For each={agents()}>
          {(agent) => (
            <MenuV2.Item data-add-member={agent.slug} onSelect={() => addToChat(props.chatId, agent)}>
              <IdentityAvatar seed={agent.slug} size={18} />
              {agent.name}
            </MenuV2.Item>
          )}
        </For>
      </Show>
    </MenuV2.Group>
  )
}
