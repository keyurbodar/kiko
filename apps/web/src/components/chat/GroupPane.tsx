import { useEffect, useMemo, useRef, useState } from "react";
import { FIXTURE_GROUPS } from "../../fixtures/roster";
import type { RosterBot, RosterGroup } from "../../lib/roster";
import { T3Composer } from "../composer/T3Composer";
import { BotAvatar } from "../roster";
import { MessageBubble } from "./MessageBubble";
import { COMPOSER_OVERLAY_SEED_PX, JumpToLatest, MessageMeta } from "./ThreadPane";

interface GroupLogEntry {
  id: string;
  from: string;
  body: string;
  createdAt: number;
  delivered: number;
  total: number;
}

const FIXTURE_GROUP_LOG: GroupLogEntry[] = [];

const openImageNoop = () => {};

export function GroupPane({ group, bots }: { group: RosterGroup; bots: RosterBot[] }) {
  const fixtureGroup = FIXTURE_GROUPS.find((candidate) => candidate.id === group.id) ?? group;
  const entries = FIXTURE_GROUP_LOG;
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(COMPOSER_OVERLAY_SEED_PX);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const threadKey = `group-${group.id.trim()}`;

  const botBySid = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const send = (text: string) => {
    const body = text.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    Promise.resolve()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSending(false));
  };

  return (
    <main className="main">
      <div className="thread relative">
        {error !== null ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground">
            No messages yet — say hello to the crew.
          </p>
        ) : (
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              data-testid="group-thread"
              className="h-full overflow-y-auto overflow-x-hidden px-3 pt-[var(--workspace-topbar-height)] sm:px-5"
              onScroll={(event) => {
                const el = event.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                setShowJump(!atBottom.current);
              }}
            >
              <div
                className="mx-auto flex w-full min-w-0 max-w-3xl flex-col pt-3"
                style={{ paddingBottom: overlayHeight }}
              >
                {entries.map((entry) => {
                  const ts = entry.createdAt;
                  const vm = {
                    id: entry.id,
                    role: entry.from === "user" ? ("user" as const) : ("bot" as const),
                    text: entry.body,
                    attachments: [],
                    ts,
                  };
                  if (entry.from === "user") {
                    return (
                      <div key={entry.id} className="group flex flex-col items-end pb-4">
                        <div className="w-fit min-w-0 max-w-[80%]">
                          <MessageBubble vm={vm} bots={bots} onOpenImage={openImageNoop} />
                        </div>
                        <div className="flex items-center gap-2 pr-1">
                          <span
                            data-testid={`group-ack-${entry.id}`}
                            className="text-caption-1 tabular-nums text-muted-foreground"
                          >
                            {entry.delivered === entry.total
                              ? `Delivered to ${entry.total}`
                              : `Delivered to ${entry.delivered} of ${entry.total}`}
                          </span>
                          <MessageMeta text={entry.body} ts={ts} side="end" />
                        </div>
                      </div>
                    );
                  }
                  const bot = botBySid.get(entry.from);
                  return (
                    <div key={entry.id} className="group flex items-start gap-2.5 pb-4">
                      <span className="mt-4 flex size-7 shrink-0 items-center justify-center">
                        {bot !== undefined ? (
                          <BotAvatar name={bot.name} src={bot.avatarImage} size={28} />
                        ) : (
                          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-muted-foreground">
                            {entry.from.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <MessageBubble
                          vm={vm}
                          senderLabel={
                            fixtureGroup.memberIds.includes(entry.from)
                              ? (bot?.name ?? entry.from)
                              : `${fixtureGroup.name} · coordinator`
                          }
                          bots={bots}
                          onOpenImage={openImageNoop}
                        />
                        <MessageMeta text={entry.body} ts={ts} side="start" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <JumpToLatest
              visible={showJump}
              bottomOffset={overlayHeight}
              onJump={() => {
                const el = scrollRef.current;
                if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                atBottom.current = true;
                setShowJump(false);
              }}
            />
          </div>
        )}
        <T3Composer
          threadKey={threadKey}
          running={sending}
          onSend={send}
          onAbort={() => setSending(false)}
          onOverlayHeightChange={setOverlayHeight}
        />
      </div>
    </main>
  );
}
