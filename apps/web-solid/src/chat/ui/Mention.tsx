import { createContext, Show, useContext, type JSX } from "solid-js"
import { identityLook, identityTint } from "../../lib/identity"
import { IdentityAvatar } from "../../lib/IdentityAvatar"

/**
 * Who a mention names. The transcript provides the open room's members, so a bubble never
 * reads the store. A slug that is not a member renders as plain `@text`.
 */
export const MentionLookup = createContext<(slug: string) => { name: string } | undefined>(() => undefined)

/**
 * An `@mention` of a member, inline in a bubble: the agent's small face and `@name` on a soft
 * tint of its colour, with no border (`docs/reference/group-chat/01.png`). It stays an
 * inline box, so it flows with the words around it and never takes a line of its own.
 */
export function Mention(props: { slug: string; text?: string }): JSX.Element {
  const lookup = useContext(MentionLookup)
  const member = () => lookup(props.slug)
  return (
    <Show when={member()} fallback={<span class="font-medium">{props.text ?? `@${props.slug}`}</span>}>
      {(m) => (
        <span
          class="inline-flex items-baseline gap-[0.25em] rounded-full px-[0.4em] align-baseline font-medium leading-[1.3] whitespace-nowrap"
          style={{ color: identityLook(props.slug).color, background: identityTint(props.slug, 16) }}
          data-component="chat-mention"
          data-slug={props.slug}
        >
          <IdentityAvatar seed={props.slug} class="size-[0.95em] self-center" />
          <span>@{m().name}</span>
        </span>
      )}
    </Show>
  )
}
