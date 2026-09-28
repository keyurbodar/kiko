// components/chat/ActivityRow.tsx — working row shown while the tail turn
// streams. Pairs the responsible bot's avatar (resolved upstream from
// turn.senderId, shell active-bot slot as fallback) with the Interior
// TypingIndicator dots: the avatar wears a theme-shimmer sheen sweep
// (existing animate-shimmer, no new animation files) while the turn works,
// and the whole row unmounts the moment the turn settles — settled bubbles
// stay avatar-free, and error/halted turns render the retry row instead, so
// no orphan avatar survives failure.
import type { ReactNode } from "react";

import { TypingIndicator } from "../interior/typing-indicator";

export function ActivityRow({
  avatarSlot = null,
  name = "Assistant",
}: {
  avatarSlot?: ReactNode;
  /** Bot name for the indicator's screen-reader announcement. */
  name?: string;
}) {
  return (
    <div
      aria-live="polite"
      data-testid="activity-row"
      className="flex w-full items-center justify-start text-subheadline"
    >
      <div className="flex w-fit min-w-0 max-w-[65%] items-center gap-2.5 py-1">
        {avatarSlot !== null && (
          <span
            data-testid="activity-avatar"
            aria-hidden
            className="inline-flex shrink-0 overflow-hidden rounded-full"
          >
            {avatarSlot}
          </span>
        )}
        <TypingIndicator typists={[name]} size={22} showLabel={false} announceAfter={0} />
      </div>
    </div>
  );
}
