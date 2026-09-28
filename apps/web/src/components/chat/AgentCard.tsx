// components/chat/AgentCard.tsx — clickable agent handoff card: avatar,
// name, task, and a status pill.
import type { ReactNode } from "react";

const statusClass: Record<string, string> = {
  running: "bg-accent text-foreground",
  done: "bg-success/8 text-success-foreground dark:bg-success/16",
  failed: "bg-destructive/8 text-destructive-foreground dark:bg-destructive/16",
};

export function AgentCard({
  avatar = null,
  name,
  task,
  status = "running",
  statusLabel,
  onOpen,
}: {
  avatar?: ReactNode;
  name: string;
  task: string;
  status?: "running" | "done" | "failed";
  statusLabel?: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="agent-card"
      aria-label={`Open ${name}`}
      onClick={() => onOpen?.()}
      className="flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg bg-card px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      {avatar !== null && (
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {avatar}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-subheadline font-medium">{name}</span>
        <span className="block max-w-[260px] truncate text-caption-2 text-muted-foreground">
          {task}
        </span>
      </span>
      <span
        data-testid="agent-status"
        data-state={status}
        className={`shrink-0 rounded-full px-2 py-0.5 text-caption-2 font-medium ${statusClass[status] ?? statusClass.running}`}
      >
        {statusLabel ?? status}
      </span>
    </button>
  );
}
