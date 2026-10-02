import { cn } from "../../lib/cn"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
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
      <Show when={useApp.activeThreadId()}>{(id) => <IdentityAvatar seed={id()} size={64} />}</Show>
      <span class="chat-empty__text text-sm lowercase">
        {props.hint ?? "no messages yet. say something to start the thread."}
      </span>
    </div>
  )
}
