// Overlapping member avatars for group rows, ported from akeru's
// GroupMemberStack.tsx (MIT): three members arranged in a triangle with
// slight overlap.
import type { RosterBot, RosterGroup } from "../../lib/roster";
import BotAvatar from "./BotAvatar";
import { cn } from "./roster.logic";

const MEMBER_POSITIONS = [
  "left-[4%] top-[4%]",
  "right-[4%] top-[4%]",
  "bottom-[4%] left-1/2 -translate-x-1/2 z-10",
] as const;

export function GroupMemberStack({
  group,
  bots,
  sizeClassName = "size-8",
  className,
}: {
  group: RosterGroup;
  bots: readonly RosterBot[];
  sizeClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex shrink-0",
        sizeClassName,
        className,
      )}
    >
      {group.memberIds.slice(0, 3).map((memberId, index) => {
        const bot = bots.find((candidate) => candidate.id === memberId);
        return (
          <span
            key={memberId}
            className={cn(
              "absolute grid size-[52%] place-items-center rounded-full",
              MEMBER_POSITIONS[index],
            )}
          >
            <BotAvatar
              name={bot?.name ?? memberId}
              src={bot?.avatarImage}
              className="size-full"
            />
          </span>
        );
      })}
    </div>
  );
}
