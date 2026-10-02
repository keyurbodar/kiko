import { Show, type JSX } from "solid-js"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { loadInfoPanel, openInfo } from "../info/state"

/** `3 members`. The human counts, as Telegram counts everyone in a group. */
export const membersLabel = (agents: number) => `${agents + 1} members`

/**
 * The group's line in the top bar: its stacked faces, its name, and `<n> members`, the way a
 * Telegram group's header reads. It opens the chat info panel, where the members are. A chat
 * with one agent shows nothing here; its tab already names it.
 */
export function GroupHeader(props: { chatId: string | null }): JSX.Element {
  /*
   * The room lists its members once it has seeded them, which for a new chat is its first
   * message. Until then the agents the chat was made with stand in, so a new group reads as one.
   */
  const count = () => {
    const live = useApp.members().length
    if (live) return live
    return useApp.user()?.chats().find((c) => c.roomId === props.chatId)?.agents?.length ?? 0
  }
  const group = () => (props.chatId !== null && useApp.activeThreadId() === props.chatId && count() > 1 ? props.chatId : null)
  return (
    <Show when={group()}>
      {(id) => (
        <button
          type="button"
          class="flex h-9 min-w-0 shrink items-center gap-2 rounded-[10px] px-2 text-left hover:bg-[var(--tab-bg-hover)] md:h-7"
          data-component="group-header"
          aria-label="group info"
          onPointerEnter={() => void loadInfoPanel()}
          onClick={() => openInfo({ kind: "home" })}
        >
          <ChatAvatar faces={useApp.chatFaces(id())} size={20} />
          <span class="min-w-0 truncate text-xs text-text">{useApp.chatById(id())?.name}</span>
          <span class="shrink-0 text-xs text-weak" data-component="group-member-count">
            {membersLabel(count())}
          </span>
        </button>
      )}
    </Show>
  )
}
