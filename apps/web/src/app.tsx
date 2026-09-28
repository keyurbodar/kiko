import { useEffect, useMemo, useRef, useState } from "react";
import { seedT3ComposerDraft, T3Composer } from "./components/composer/T3Composer";
import { ChatHeader, GroupPane, ThreadPane, useFixturePlayback } from "./components/chat";
import { useThread, type SessionRef, type TurnViewState } from "./components/thread";
import { BotAvatar, GroupMemberStack } from "./components/roster";
import type { RosterBot, RosterGroup } from "./lib/roster";
import { Shimmer } from "./components/aicss";
import { BotRosterSidebar, useRosterState } from "./components/roster";
import { fetchKeyedProviders, sessionForOwner, type SessionHandle } from "./lib/session";
import { clearReplyTarget } from "./components/chat/replyStore";
import { CommandPaletteHost } from "./components/CommandPaletteHost";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/ui/empty";
import { ToastProvider } from "./components/ui/toast";

type BootState =
  | { status: "loading" }
  | { status: "unkeyed" }
  | { status: "error"; message: string }
  | { status: "ready" };

const UNKEYED_MESSAGE =
  "No model provider key is set on the backend, so turns cannot run. " +
  "Set a provider key as a Worker secret (for example ANTHROPIC_API_KEY), redeploy, then reload.";

export default function App() {
  const roster = useRosterState();
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [narrowViewport, setNarrowViewport] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keyed = await fetchKeyedProviders();
        if (cancelled) return;
        if (keyed.length === 0) {
          setBoot({ status: "unkeyed" });
          return;
        }
        // Fresh session every load: no stored handle, no stale history.
        setBoot({ status: "ready" });
      } catch (e) {
        if (cancelled) return;
        setBoot({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const onChange = (event: MediaQueryListEvent) => setNarrowViewport(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const activeBot = useMemo(() => {
    if (roster.activeId === null) return null;
    return roster.bots.find((candidate) => candidate.id === roster.activeId) ?? null;
  }, [roster.activeId, roster.bots]);
  const activeName = useMemo(() => {
    if (activeBot !== null) return activeBot.name;
    return roster.groups.find((group) => group.id === roster.activeId)?.name ?? null;
  }, [activeBot, roster.activeId, roster.groups]);

  const activeGroup = useMemo(() => {
    if (activeBot !== null || roster.activeId === null) return null;
    return roster.groups.find((group) => group.id === roster.activeId) ?? null;
  }, [activeBot, roster.activeId, roster.groups]);
  const presenceText = useMemo(() => {
    if (activeBot !== null) return PRESENCE_TEXT[activeBot.presence];
    if (activeGroup !== null) return `Group · ${activeGroup.memberIds.length} members`;
    return "pi-do";
  }, [activeBot, activeGroup]);
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <div
        className={`shrink-0 overflow-hidden transition-[width] duration-150 ease-out ${
          roster.railCollapsed || narrowViewport ? "w-12" : "w-72"
        }`}
      >
        <BotRosterSidebar api={roster} narrowViewport={narrowViewport} />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="absolute inset-x-0 top-0 z-20 flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] items-center gap-3 bg-background/60 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] backdrop-blur-md sm:pl-[calc(env(safe-area-inset-left)+1.25rem)] sm:pr-[calc(env(safe-area-inset-right)+1.25rem)]">
          <ChatHeader
            name={activeName ?? "pi-do"}
            presenceText={presenceText}
            avatar={
              activeBot !== null ? (
                <BotAvatar
                  name={activeBot.name}
                  src={activeBot.avatarImage}
                  size={22}
                />
              ) : activeGroup !== null ? (
                <GroupMemberStack group={activeGroup} bots={roster.bots} sizeClassName="size-6" />
              ) : null
            }
          />
        </header>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[var(--workspace-topbar-height)] z-10 h-6 bg-gradient-to-b from-background/60 to-transparent"
        />
        <ChatPane
          boot={boot}
          activeBot={activeBot}
          activeGroup={activeGroup}
          activeId={roster.activeId}
          bots={roster.bots}
          groups={roster.groups}
          onActivity={roster.setActivity}
          onOpenGroup={roster.setActive}
        />
      </div>
      <CommandPaletteHost api={roster} />
      <ToastProvider position="bottom-right" />
    </div>
  );
}

const PRESENCE_TEXT: Record<RosterBot["presence"], string> = {
  idle: "Idle",
  typing: "Typing…",
  working: "Working…",
  sleeping: "Away",
};

function ChatPane({
  boot,
  activeBot,
  activeGroup,
  activeId,
  bots,
  groups,
  onActivity,
  onOpenGroup,
}: {
  boot: BootState;
  activeBot: RosterBot | null;
  activeGroup: RosterGroup | null;
  activeId: string | null;
  bots: RosterBot[];
  groups: RosterGroup[];
  onActivity: (id: string, preview: string, presence: RosterBot["presence"]) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  if (boot.status === "loading") {
    return (
      <main className="main">
        <div className="thread">
          <p className="text-muted-foreground">
            <Shimmer>Connecting…</Shimmer>
          </p>
        </div>
      </main>
    );
  }

  if (boot.status === "unkeyed" || boot.status === "error") {
    return (
      <main className="main">
        <div className="thread" role="alert">
          <p className="text-destructive">{boot.status === "unkeyed" ? UNKEYED_MESSAGE : boot.message}</p>
        </div>
      </main>
    );
  }
  if (activeGroup !== null) {
    return <GroupPane key={activeGroup.id} group={activeGroup} bots={bots} />;
  }

  if (activeId === null) {
    return (
      <main className="main">
        <Empty data-testid="empty-state-no-bot">
          <EmptyHeader>
            <EmptyMedia>
              <BotAvatar name="Kiko" size={96} />
            </EmptyMedia>
            <EmptyTitle className="text-body text-foreground">Pick a bot to start chatting</EmptyTitle>
            <EmptyDescription className="text-muted-foreground">
              Or press ⌘K to search bots, groups, and actions
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    );
  }

  return (
    <ReadyThread
      key={activeId}
      ownerId={activeId}
      activeBot={activeBot}
      bots={bots}
      groups={groups}
      onActivity={onActivity}
      onOpenGroup={onOpenGroup}
    />
  );
}

function ReadyThread({
  ownerId,
  activeBot,
  bots,
  groups,
  onActivity,
  onOpenGroup,
}: {
  ownerId: string;
  activeBot: RosterBot | null;
  bots: RosterBot[];
  groups: RosterGroup[];
  onActivity: (id: string, preview: string, presence: RosterBot["presence"]) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const [session, setSession] = useState<SessionHandle | null | false>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    sessionForOwner(ownerId).then(
      (s) => {
        if (!cancelled) setSession(s ?? false);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ownerId]);
  if (error !== null) {
    return (
      <main className="main">
        <div className="thread" role="alert">
          <p className="text-destructive">{error}</p>
        </div>
      </main>
    );
  }
  if (session === false) {
    // Group owners route to GroupPane upstream; a null here means the owner
    // has no session to claim.
    return (
      <main className="main">
        <Empty>
          <EmptyDescription className="text-muted-foreground">
            This conversation has no session.
          </EmptyDescription>
        </Empty>
      </main>
    );
  }
  if (session === null) {
    return (
      <main className="main">
        <div className="thread">
          <p className="text-muted-foreground">
            <Shimmer>Connecting…</Shimmer>
          </p>
        </div>
      </main>
    );
  }
  return (
    <ReadyThreadInner
      key={session.sessionId}
      session={session}
      ownerId={ownerId}
      activeBot={activeBot}
      bots={bots}
      groups={groups}
      onActivity={onActivity}
      onOpenGroup={onOpenGroup}
    />
  );
}
function ReadyThreadInner({
  session,
  ownerId,
  activeBot,
  bots,
  groups,
  onActivity,
  onOpenGroup,
}: {
  session: SessionRef;
  ownerId: string;
  activeBot: RosterBot | null;
  bots: RosterBot[];
  groups: RosterGroup[];
  onActivity: (id: string, preview: string, presence: RosterBot["presence"]) => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const threadNames = useMemo(
    () =>
      Object.fromEntries(
        groups.flatMap((group) => [
          [group.id, group.name],
          [`group-${group.id}`, group.name],
        ]),
      ),
    [groups],
  );
  const thread = useThread(session);
  const playback = useFixturePlayback(activeBot?.id ?? ownerId);
  const lastTurn = thread.turns[thread.turns.length - 1] ?? null;
  const preview =
    lastTurn === null ? null : lastTurnPreview(lastTurn, activeBot?.name ?? "the agent");
  useEffect(() => {
    if (activeBot === null || preview === null) return;
    onActivity(activeBot.id, preview, thread.running ? "typing" : "idle");
  }, [activeBot, preview, thread.running, onActivity]);
  // Unmount/bot-switch only: reset presence so a mid-stream switch can't
  // leave "Typing…" persisted on a bot that is no longer running here.
  const activeBotId = activeBot?.id ?? null;
  const lastPreviewRef = useRef<string | null>(null);
  lastPreviewRef.current = preview;
  useEffect(() => {
    if (activeBotId === null) return;
    return () =>
      onActivity(activeBotId, lastPreviewRef.current ?? activeBot?.preview ?? "", "idle");
  }, [activeBotId, onActivity]);
  useEffect(() => {
    clearReplyTarget();
  }, [ownerId]);
  const threadKey = ownerId.trim();
  const send = (text: string) => {
    thread.send(text);
  };
  const openGroup = (threadId: string) => {
    const id = threadId.startsWith("group-") ? threadId.slice("group-".length) : threadId;
    if (groups.some((group) => group.id === id)) onOpenGroup(id);
  };
  const editInComposer = (text: string) => {
    seedT3ComposerDraft(threadKey, text);
  };
  return (
    <main className="main">
      <div className="thread">
        <ThreadPane
          onRetry={send}
          turns={[...playback.turns, ...thread.turns]}
          pending={thread.pending}
          conn={thread.conn}
          playing={playback.playing}
          threadNames={threadNames}
          onEdit={editInComposer}
          onOpenGroup={openGroup}
          bots={bots}
          /* Resting face only: ThreadPane shows this slot beside the working dots,
             and a typing/live presence would collapse the engine into dot-state. */
          avatarSlot={
            activeBot ? (
              <BotAvatar
                name={activeBot.name}
                src={activeBot.avatarImage}
                size={36}
              />
            ) : null
          }
          renderComposer={(onOverlayHeightChange) => (
            <T3Composer
              threadKey={threadKey}
              running={thread.running}
              onSend={send}
              onAbort={thread.abort}
              onOverlayHeightChange={onOverlayHeightChange}
            />
          )}
        />
      </div>
    </main>
  );
}

function lastTurnPreview(turn: TurnViewState, botName: string): string | null {
  const botPart = [...turn.parts].reverse().find((part) => part.type === "text");
  const text = (botPart !== undefined && "text" in botPart ? botPart.text : turn.prompt).trim();
  if (text.length > 0) {
    return `${botPart === undefined ? "You: " : ""}${text.slice(0, 140)}`;
  }
  if ((turn.attachments ?? []).length > 0) {
    return botPart === undefined ? "You sent an attachment." : `${botName} sent an attachment.`;
  }
  return null;
}
