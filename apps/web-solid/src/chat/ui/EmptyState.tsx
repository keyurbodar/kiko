import { cn } from "../../lib/cn"
import { ChatAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { Show } from "solid-js"

/**
 * The no-messages state. It sits in the scroller rather than beside it, so an
 * empty thread still lays out as a centred measure on the app background and
 * the fades above it have nothing to mask. The hint is chrome, so it is
 * lowercased like every other label here; nothing that carries a message body
 * is ever transformed. The card shows the chat's one avatar, seeded by room id.
 */
export function EmptyState(props: { hint?: string; class?: string }) {
  return (
    <div
      class={cn(
        "chat-empty flex flex-col items-center gap-1.5 px-4 py-12 text-center text-weak",
        props.class,
      )}
      data-component="chat-empty"
    >
      <Show when={useApp.activeThreadId()}>{(id) => <ChatAvatar faces={useApp.chatFaces(id())} size={64} />}</Show>
      <Show when={useApp.activeThreadId()}>
        {(id) => (
          <span class="mt-1 text-base font-medium text-text" data-component="chat-empty-name">
            {useApp.chatById(id())?.name}
          </span>
        )}
      </Show>
      <span class="chat-empty__text text-sm lowercase">
        {props.hint ?? "no messages yet. say something to start the thread."}
      </span>
      <Show when={!props.hint}>
        <span class="text-xs lowercase opacity-80" data-component="chat-empty-tips">
          {useApp.members().length > 1
            ? "type @ to mention an agent, / for commands"
            : "type / for commands, shift+enter for a new line"}
        </span>
      </Show>
    </div>
  )
}
