import { Show, createEffect, createMemo, createSignal, lazy, on } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { Icon as IconV2 } from "@kiko/ui/v2/icon";
import { MessageList, type VirtualThreadState } from "../../chat/MessageList";
import { Composer } from "../../composer/composer";
import { ModelPickerButton } from "../../settings/model-picker";
import { useApp } from "../../lib/store";
import type { MessageId } from "@kiko/protocol";
import type { ChatMessage } from "../../lib/types";
import { connectedProviders, connectedReady } from "../../settings/connected";
import { hasModelProvider } from "../../settings/provider-kinds";
import { jumpRequest, requestJump } from "../../search/state";
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
  // A message that points to another chat (kiko made an agent or a group) takes the reader there once, when it arrives here.
  createEffect(
    on(
      [() => params.id, () => useApp.activeMessages().at(-1)],
      ([id, last], previous) => {
        if (!previous || previous[0] !== id || !last?.goto || last.goto === id || last.id === previous[1]?.id) return;
        navigate(`/chat/${last.goto}`);
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
  let replyKey = "";
  createEffect(
    on(draftKey, (key) => {
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
  const agentName = (slug: string) => members().get(slug)?.name ?? slug;
  const messages = createMemo(() => useApp.activeMessages());
  const notices = createMemo(() =>
    useApp.memberNotices().map((n) => ({ key: `${n.seq}`, seq: n.seq, at: n.at, text: `${n.name} ${n.kind}` })),
  );
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
      if (!found) return void (landing = false);
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

  const empty = () => messages().length === 0;
  let dock: HTMLDivElement | undefined;
  let launch: Launch | null = null;
  createEffect(
    on(empty, (now, before) => {
      if (before && !now && dock) glideToDock(dock, launch);
      launch = null;
    }),
  );

  return (
    <>

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
            notices={notices()}
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
          <EmptyState faces={useApp.chatFaces(useApp.activeThreadId() ?? "")} names={members().size > 1 ? [...members().values()].map((m) => m.name) : []} />
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

          <Show when={scrolled()}>
            <div class="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6px)] z-6 flex justify-center">
              <button
                type="button"
                class="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] bg-[color-mix(in_oklab,var(--background)_80%,transparent)] px-2.5 text-xs font-medium text-foreground shadow-md backdrop-blur-md"
                data-component="composer-scroll-down"
                aria-label="Scroll to end"
                onPointerDown={(event) => event.preventDefault()}
                onClick={toLatest}
              >
                <IconV2 name="chevron-down" class="size-3.5" />
                Scroll to end
              </button>
            </div>
          </Show>
          <BrowserChip slugs={[...members().keys()]} />

          <Show when={useApp.room()?.state.noProvider ?? (connectedReady() && !hasModelProvider(connectedProviders()))}>
            {(np) => (
              <div
                class="mx-1.5 mb-1.5 flex items-center gap-3 rounded-lg bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] py-1 pr-1 pl-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)] backdrop-blur-sm"
                role="status"
                data-component="no-provider"
              >
                <span class="min-w-0 flex-1">
                  {typeof np() === "object"
                    ? `${agentName((np() as { slug: string }).slug)} can't reply yet: no ${(np() as { provider: string }).provider} key is connected.`
                    : "Connect a provider so your agents can reply."}
                </span>

                <A href="/settings/models" class="inline-flex h-7 shrink-0 items-center rounded-md bg-[var(--primary)] px-3 text-[12px] font-medium text-[var(--primary-foreground)] no-underline hover:bg-[var(--primary-hover)]">
                  Connect
                </A>
              </div>
            )}
          </Show>
          <QuoteOnSelect
            onQuote={(id, text) => {
              setReplyTarget(id);
              setQuote({ target: id, text });
              document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus();
            }}
          />

          <Composer
            tray={<ModelPickerButton chatId={params.id ?? null} />}
            threadId={useApp.activeThreadId() ?? ""}
            title={useApp.chatById(useApp.activeThreadId() ?? "")?.name}
            draftKey={draftKey()}
            draftFor={(key) => book()?.get(key)?.text ?? ""}
            onDraftChange={(key, text) => {
              book()?.save(key, { text });
              if (text !== "") useApp.typing();
            }}
            bots={useApp.members()}
            onSend={(message) => {
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
    </>
  );
}
