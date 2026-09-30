import { formatTimeOfDay } from "../lib/dayLabel"

/**
 * The per-message timestamp. It is placed against the row (its containing
 * block) and revealed by `--chat-time-reveal`, which the row sets on
 * `:hover` / `:focus-within`. There is no timer and no transition here: the
 * timestamp is either revealed or it is not.
 */
export function RowTime(props: { sentAt: number }) {
  return (
    <time class="chat-row-time" data-component="chat-row-time" datetime={new Date(props.sentAt).toISOString()}>
      {formatTimeOfDay(props.sentAt)}
    </time>
  )
}
