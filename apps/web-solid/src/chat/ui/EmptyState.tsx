import { HugeIcon } from "@kiko/ui/huge-icon"
import { Bird } from "../../mascot/bird"
import { cn } from "../../lib/cn"

/**
 * The no-messages state, as kat draws it: the mascot, dim and centred, with a
 * small heart above it. No instructions; the composer's placeholder already
 * says who to message, and the slash menu finds itself.
 */
export function EmptyState(props: { class?: string }) {
  return (
    <div
      class={cn(
        "chat-empty pointer-events-none flex min-h-[calc(100dvh-16rem)] flex-1 select-none items-center justify-center",
        props.class,
      )}
      data-component="chat-empty"
      aria-hidden="true"
    >
      <span class="relative opacity-30 grayscale">
        <HugeIcon name="heart" size={18} stroke-width={1.75} class="absolute -top-3 -left-2 text-text" />
        <Bird spec={{ species: "kiko", tint: 0, accessory: "none" }} size={72} />
      </span>
    </div>
  )
}
