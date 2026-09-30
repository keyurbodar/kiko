import { cn } from "../../lib/cn"
import { formatTimeOfDay } from "../lib/dayLabel"

/**
 * The per-message timestamp. It is placed against the row (its containing
 * block) and revealed by `--chat-time-reveal`, which the row sets on
 * `:hover` / `:focus-within`. There is no timer and no transition here: the
 * timestamp is either revealed or it is not, so the only declaration that
 * carries the reveal is the opacity that reads the variable.
 */
export function RowTime(props: { sentAt: number; class?: string }) {
  return (
    <time
      class={cn(
        "chat-row-time absolute end-0 bottom-0 text-xs text-weak whitespace-nowrap",
        "pointer-events-none opacity-(--chat-time-reveal)",
        props.class,
      )}
      data-component="chat-row-time"
      datetime={new Date(props.sentAt).toISOString()}
    >
      {formatTimeOfDay(props.sentAt)}
    </time>
  )
}
