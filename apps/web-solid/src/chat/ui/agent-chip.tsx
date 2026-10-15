import { identityLook, identityTint } from "../../lib/identity"
import { IdentityAvatar } from "../../lib/IdentityAvatar"

export function AgentChip(props: { slug: string; name: string; handle?: boolean; wrap?: boolean }) {
  return <span
    class="inline-flex items-baseline gap-[0.25em] rounded-full px-[0.4em] align-baseline font-medium leading-[1.3] whitespace-nowrap"
    classList={{ "max-w-full": props.wrap }}
    style={{ color: identityLook(props.slug).color, background: identityTint(props.slug, 16) }}
    data-component={props.handle ? "chat-mention" : "agent-chip"}
    data-slug={props.slug}
  >
    <IdentityAvatar seed={props.slug} class="size-[0.95em] self-center" />
    <span class={props.wrap ? "min-w-0 whitespace-normal wrap-anywhere" : undefined}>{props.handle ? "@" : ""}{props.name}</span>
  </span>
}
