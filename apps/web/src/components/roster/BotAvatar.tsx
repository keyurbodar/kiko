import { sleepy } from "blobatar/expression";
import type { BotPresence } from "../../lib/roster";
import { Blobatar, FACE_SCALE } from "../ui/blobatar";
import { cn } from "../ui/cn";
import { PresenceAvatar, type PresenceState } from "../ui/presence-avatar";

export interface BotAvatarProps {
  name: string;
  src?: string;
  size?: number;
  presence?: BotPresence;
  className?: string;
}

const PRESENCE_STATE: Record<BotPresence, PresenceState> = {
  idle: "online",
  typing: "thinking",
  working: "thinking",
  sleeping: "offline",
};

export default function BotAvatar({
  name,
  src,
  size,
  presence,
  className,
}: BotAvatarProps) {
  const box = cn("relative inline-block size-10 shrink-0", className);
  const boxStyle = size === undefined ? undefined : { height: size, width: size };

  return (
    <span className={box} style={boxStyle}>
      {src !== undefined ? (
        <Blobatar alt="" className="size-full" name={name} src={src} />
      ) : presence === undefined ? (
        <Blobatar alt="" className={cn("size-full", FACE_SCALE)} name={name} />
      ) : (
        <PresenceAvatar
          blobatar={presence === "sleeping" ? { expression: sleepy } : undefined}
          className="size-full"
          name={name}
          state={PRESENCE_STATE[presence]}
        />
      )}
    </span>
  );
}
