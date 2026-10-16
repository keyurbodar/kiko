import { Suspense, Show, createEffect, createMemo, createSignal, lazy, on } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Icon as IconV2 } from "@kiko/ui/v2/icon";
import { MessageList, type VirtualThreadState } from "../../chat/MessageList";
import { Composer } from "../../composer/composer";
import { ModelPickerButton } from "../../settings/model-picker";
import { useApp } from "../../lib/store";
import type { MessageId } from "@kiko/protocol";
import type { ChatMessage } from "../../lib/types";
import { jumpRequest, requestJump } from "../../search/state";
import { eventText } from "../../chat/lib/event-line";
import { EmptyState } from "../../chat/ui/EmptyState";
import { captureLaunch, glideToDock, type Launch } from "../../chat/send-motion";
const QuoteOnSelect = lazy(() => import("../../chat/QuoteOnSelect"));
const BrowserChip = lazy(() => import("../../chat/BrowserChip"));

const JUMP_CLASS =
  "pointer-events-auto relative grid size-[26px] place-items-center rounded-md border border-[color-mix(in_oklab,var(--foreground)_15%,transparent)] bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] text-foreground shadow-md backdrop-blur-md";

export default function ChatRoute() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  createEffect(() => {
    const id = params.id;
    if (id && id !== useApp.activeThreadId()) useApp.selectThread(id);
  });
  createEffect(() => {
    const id = params.id;
    const user = useApp.user();
    if (!id || !user?.state.synced || useApp.chat(id)) return;
    const next = user.state.refused[id] ?? useApp.resumeChat();
    if (next && next !== id) navigate(`/chat/${next}`, { replace: true });
  });
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id || window.matchMedia("(pointer: coarse)").matches) return;
        requestAnimationFrame(() => {
          const active = document.activeElement;
          const typing = active instanceof HTMLElement && (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName));
          if (typing || (active instanceof HTMLElement && active.closest('[role="tab"]'))) return;
          document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus();
        });
      },
    ),
  );
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null);
  const [editTarget, setEditTarget] = createSignal<string | null>(null);
  createEffect(on(() => params.id, () => setEditTarget(null), { defer: true }));
  const startEdit = (id: string) => {
    setReplyTarget(null);
    setEditTarget(id);
  };
  const [quote, setQuote] = createSignal<{ target: string; text: string } | null>(null);
  const replyQuote = () => {
    const q = quote();
    return q && q.target === replyTarget() ? q.text : undefined;
  };
  const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);
  const book = () => useApp.drafts();
  const draftKey = () => (book()?.ready() ? (useApp.activeThreadId() ?? "") : "");
  // The words typed so far, so the composer's model chip follows an @tag in the draft.
  const [draft, setDraft] = createSignal("");
  let replyKey = "";
  createEffect(
    on(draftKey, (key) => {
      setDraft(key ? (book()?.get(key)?.text ?? "") : "");
      replyKey = "";
      setReplyTarget((key && (book()?.get(key)?.replyTo ?? null)) || null);
      replyKey = key;
    }),
  );
  createEffect(
    on(replyTarget, (target) => {
      if (!replyKey || replyKey !== draftKey()) return;
      book()?.save(replyKey, { replyTo: target !== null && !target.startsWith("local:") ? (target as MessageId) : null });
    }, { defer: true }),
  );
  createEffect(() => {
    const id = useApp.activeThreadId();
    if (id && useApp.hasUnread()) useApp.markRead(id);
  });
  const members = createMemo(() => new Map(useApp.members().map((member) => [member.id, member])));
  const messages = createMemo(() => useApp.activeMessages());
  const byId = createMemo(
    () => new Map<string, ChatMessage>(messages().map((message) => [message.id, message])),
  );
  const replyTo = createMemo(() => {
    const id = replyTarget();
    return id === null ? null : (byId().get(id) ?? null);
  });

  let jumpToMessage: ((messageId: string) => void) | undefined;
  let scrollToLatest: (() => void) | undefined;

  let landing = false;
  createEffect(() => {
    const request = jumpRequest();
    if (!request || request.roomId !== useApp.activeThreadId()) return;
    requestJump(null);
    landing = true;
    void useApp.jumpTo(request.seq).then((found) => {
      if (!found) {
        landing = false
        return
      }
      jumpToMessage?.(request.id);
      requestAnimationFrame(() => {
        jumpToMessage?.(request.id);
        requestAnimationFrame(() => (landing = false));
      });
    });
  });
  const toLatest = () => {
    if (!useApp.showingHistory()) return scrollToLatest?.();
    useApp.goLive();
    requestAnimationFrame(() => scrollToLatest?.());
  };

  const scrolled = () => {
    const state = threadState();
    if (!state) return false;
    return state.scrollOffset + state.viewportSize < state.scrollSize - 1 || useApp.showingHistory();
  };

  let transcript: HTMLDivElement | undefined;
  const mentions = () => useApp.unseenMentions();
  createEffect(() => {
    threadState();
    messages();
    const ids = mentions();
    if (!ids.length || !transcript) return;
    requestAnimationFrame(() => {
      if (!transcript) return;
      const box = transcript.getBoundingClientRect();
      const onScreen = ids.filter((id) => {
        const row = transcript!.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
        return !!row && row.bottom > box.top && row.top < box.bottom;
      });
      useApp.seeMentions(onScreen);
    });
  });
  const jumpToMention = () => {
    const id = mentions()[0];
    if (!id) return;
    jumpToMessage?.(id);
    useApp.seeMentions([id]);
  };

  // A divider is something to read, so a chat that has one is not empty; an event this client does not draw is nothing.
  const empty = () => messages().every((m) => m.event && eventText(m, String) === null);
  let dock: HTMLDivElement | undefined;
  let launch: Launch | null = null;
  createEffect(
    on(empty, (now, before) => {
      if (before && !now && dock) glideToDock(dock, launch);
      launch = null;
    }),
  );

  return (
    <div
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        data-component="chat-shell"
        data-session-empty={empty() ? "true" : "false"}
        data-reply-target={replyTarget() ?? undefined}
        data-range={threadState() ? `${threadState()!.rangeStart}-${threadState()!.rangeEnd}` : undefined}
      >

        <div class="flex min-h-0 flex-1 flex-col" ref={transcript} data-component="chat-transcript">
          <MessageList
            messages={messages()}
            botById={(id) => (id === undefined ? undefined : members().get(id))}
            replyParent={(id) => (id === undefined ? undefined : byId().get(id))}
            firstUnreadMessageId={useApp.firstUnreadMessageId()}
            onJumpToMessage={() => {}}
            onReplyTarget={setReplyTarget}
            scrollRef={() => {}}
            onStateChange={setThreadState}
            onNearTop={useApp.loadOlder}
            onAtLatest={() => landing || useApp.followLatest()}
            waitingNames={useApp.typingNames()}
            waitingSlugs={useApp.typingSlugs()}
            waitingDoings={useApp.typingDoings()}
            groupChat={members().size > 1}
            memberSlugs={[...members().keys()]}
            onReact={useApp.toggleReaction}
            onEdit={startEdit}
            onDelete={(id) => {
              if (editTarget() === id) setEditTarget(null);
              useApp.deleteMessage(id);
            }}
            replyTarget={replyTarget()}
            scrollKey={useApp.activeThreadId() ?? undefined}
            scrollBook={book() ?? undefined}
            onJumpHandle={(handle) => {
              jumpToMessage = handle.jumpToMessage;
              scrollToLatest = handle.scrollToLatest;
            }}
          />
        </div>


        <Show when={empty()}>
          <EmptyState />
        </Show>
        <div
          ref={dock}
          class="composer-dock"
          data-component="composer-dock"
          data-scrolled={scrolled() ? "true" : undefined}
        >

          <Show when={mentions().length > 0}>
            <div class="pointer-events-none absolute right-3 bottom-[calc(100%+8px)] z-6">
              <button
                type="button"
                class={`${JUMP_CLASS} text-sm font-medium text-ring`}
                data-component="composer-jump-mention"
                title="Next mention"
                aria-label="Next mention"
                onClick={jumpToMention}
              >
                <span aria-hidden="true">@</span>
                <span
                  class="absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full bg-ring px-1 text-center text-xs leading-4 text-[var(--primary-foreground)]"
                  data-component="composer-jump-count"
                >
                  {mentions().length}
                </span>
              </button>
            </div>
          </Show>

          <div class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6px)] z-6 flex justify-center">
            <button
              type="button"
              class="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] bg-[color-mix(in_oklab,var(--background)_80%,transparent)] px-2.5 text-xs font-medium text-foreground shadow-md backdrop-blur-md transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none data-[hidden]:pointer-events-none data-[hidden]:scale-95 data-[hidden]:opacity-0"
              data-component="composer-scroll-down"
              data-hidden={scrolled() ? undefined : ""}
              aria-label="Scroll to end"
              aria-hidden={scrolled() ? undefined : "true"}
              tabIndex={scrolled() ? 0 : -1}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toLatest}
            >
              <IconV2 name="chevron-down" class="size-3.5" />
              Scroll to end
            </button>
          </div>
          <BrowserChip slugs={[...members().keys()]} />

          <QuoteOnSelect
            onQuote={(id, text) => {
              setReplyTarget(id);
              setQuote({ target: id, text });
              document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus();
            }}
          />

          <Composer
            room={useApp.room() ?? undefined}
            stopping={!!useApp.room()?.state.agents.length}
            onStop={() => useApp.room()?.stop()}
            tray={<ModelPickerButton draft={draft()} />}
            threadId={useApp.activeThreadId() ?? ""}
            title={useApp.chatById(useApp.activeThreadId() ?? "")?.name}
            draftKey={draftKey()}
            draftFor={(key) => book()?.get(key)?.text ?? ""}
            onDraftChange={(key, text) => {
              book()?.save(key, { text });
              setDraft(text);
              if (text !== "") useApp.typing();
            }}
            bots={useApp.members()}
            onSend={(message) => {
              setDraft("");
              if (empty()) launch = captureLaunch(dock);
              const target = replyTarget();
              const fromHistory = useApp.showingHistory();
              const sent =
                target === null
                  ? useApp.appendMessage(message)
                  : useApp.appendReply(message, target, replyQuote());
              setQuote(null);
              if (sent !== undefined) (fromHistory ? requestAnimationFrame(() => scrollToLatest?.()) : scrollToLatest?.());
            }}
            replyTo={replyTo()}
            replyQuote={replyQuote()}
            onClearReply={() => (setReplyTarget(null), setQuote(null))}
            editing={editTarget() === null ? null : (byId().get(editTarget()!) ?? null)}
            onEdit={(id, text) => useApp.editMessage(id, text)}
            onCancelEdit={() => setEditTarget(null)}
            onEditLast={() => {
              const last = [...messages()].reverse().find((m) => m.sender === "user" && m.seq !== undefined && m.body.trim() !== "");
              if (last) startEdit(last.id);
            }}
            onJumpToReply={(messageId) => jumpToMessage?.(messageId)}
          />
        </div>
      </div>
  );
}
