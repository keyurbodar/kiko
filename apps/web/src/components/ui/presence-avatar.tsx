import { Blobatar } from "@blobatar/react";
import type { BlobatarOptions } from "blobatar";
import { thinking } from "blobatar/expression";
import { FACE_SCALE } from "./blobatar";
import { cn } from "./cn";

export type PresenceState = "online" | "away" | "offline" | "thinking";

const PRESENCE: Record<PresenceState, { dot?: string; label: string }> = {
  online: { dot: "bg-success", label: "online" },
  away: { dot: "bg-warning", label: "away" },
  offline: { dot: "bg-muted-foreground", label: "offline" },
  thinking: { label: "thinking" },
};

export type PresenceAvatarProps = {
  name: string;
  state?: PresenceState;
  unread?: number;
  label?: string;
  blobatar?: BlobatarOptions;
  className?: string;
};

export function PresenceAvatar({
  name,
  state = "online",
  unread,
  label,
  blobatar,
  className,
}: PresenceAvatarProps) {
  const presence = PRESENCE[state];
  const who = label ?? name;

  return (
    <span
      className={cn("relative inline-block size-10 shrink-0", className)}
      role="img"
      aria-label={
        unread ? `${who}, ${presence.label}, ${unread} unread` : `${who}, ${presence.label}`
      }
    >
      <Blobatar
        name={name}
        {...blobatar}
        animate="always"
        expression={state === "thinking" ? thinking : blobatar?.expression}
        aria-hidden="true"
        className={cn("size-full", FACE_SCALE)}
      />

      {state === "thinking" ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-[3px]"
        >
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className="bg-muted-foreground size-1 animate-pulse rounded-full"
              style={{ animationDuration: "1.1s", animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "ring-background absolute top-0 right-0 h-[26%] w-[26%] rounded-full ring-2",
            presence.dot,
          )}
        />
      )}

      {unread ? (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground ring-background absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[0.65rem] leading-none ring-2"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </span>
  );
}
