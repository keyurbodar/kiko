import { Blobatar } from "@blobatar/solid"
import { identityLook } from "./identity"

/*
 * The only component that draws a bot or a chat. Static, never `animate`: a
 * list of moving avatars is motion in a place the user is not waiting for
 * anything. `size` is in pixels. Omit it to let the parent's class size it.
 */
export function IdentityAvatar(props: { seed: string; size?: number; class?: string }) {
  const look = () => identityLook(props.seed)
  return (
    <span
      class={`inline-block shrink-0 overflow-hidden rounded-full ${props.class ?? ""}`}
      style={{
        width: props.size ? `${props.size}px` : undefined,
        height: props.size ? `${props.size}px` : undefined,
        "--identity-accent": look().accent,
      }}
      data-component="identity-avatar"
      data-seed={props.seed}
      data-accent={look().accent}
      aria-hidden="true"
    >
      <Blobatar name={look().seed} class="size-full rounded-full" />
    </span>
  )
}
