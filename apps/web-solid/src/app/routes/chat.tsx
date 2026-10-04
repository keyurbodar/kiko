import { Show, createEffect, createMemo, createSignal, lazy, on } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { Icon as IconV2 } from "@kiko/ui/v2/icon";
import { MessageList, type VirtualThreadState } from "../../chat/MessageList";
import { Composer } from "../../composer/composer";
import { useApp } from "../../lib/store";
import type { MessageId, RoomId } from "@kiko/protocol";
import type { ChatMessage } from "../../lib/types";
import { connectedProviders, connectedReady } from "../../settings/connected";
import { jumpRequest, requestJump } from "../../search/state";

// Quoting a selection loads after first paint.
const QuoteOnSelect = lazy(() => import("../../chat/QuoteOnSelect"));
// Approval cards load the first time an open room has one (P7-02).
const ApprovalCards = lazy(() => import("../../chat/ApprovalCard"));
// A temporary chat's "to:" row loads the first time one is open, not with the transcript.
const ToBar = lazy(() => import("../../chat/to-bar").then((m) => ({ default: m.ToBar })));

/*
 * The composed app: the transcript over the open room in the sync store. The
 * same props the harness passes, driven from `useApp` instead of a fixture
 * slice, so a difference between this page
 * and the harness is a difference in the data and never in the wiring.
 *
 * The transcript's own styling reaches the page through MessageList, not
 * through an import here, so the slice stays the owner of its own styles. The
 * composer is the exception and imports its own stylesheet, the way the sidebar
 * does, because it is chrome the app composes rather than a slice surface.
 */
export default function ChatRoute() {
  /*
   * The URL names the open chat. `/chat/:id` selects that thread in the store. The store still
   * holds the selection because the transcript reads it from there, but the URL is what changes it.
   * `/chat` alone never renders here: the route table sends it to the chat to resume.
   */
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  createEffect(() => {
    const id = params.id;
    if (id && id !== useApp.activeThreadId()) useApp.selectThread(id);
  });
  /*
   * A chat that is not there once the list is the server's (deleted, or a link from another
   * account) sends the reader to the chat to resume. A second direct chat the server refused goes
   * to the one the agent already has.
   */
  createEffect(() => {
    const id = params.id;
    const user = useApp.user();
    if (!id || !user?.state.synced || useApp.chat(id)) return;
    const next = user.state.refused[id] ?? useApp.resumeChat();
    if (next && next !== id) navigate(`/chat/${next}`, { replace: true });
  });
  /*
   * Opening a chat puts the cursor in the composer, the way kat and Telegram do, so the
   * next keystroke is a message. Not on a touch screen, where focus raises the keyboard
   * over the transcript, and not while the reader is typing somewhere else.
   */
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id || window.matchMedia("(pointer: coarse)").matches) return;
        requestAnimationFrame(() => {
          const active = document.activeElement;
          const typing = active instanceof HTMLElement && (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName));
          if (typing) return;
          document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus();
        });
      },
    ),
  );
  /*
   * A temporary chat (architecture section 7.11). When kiko makes an agent in it, a line points at
   * the agent's new chat, and the human is taken there. Closing its tab deletes it; leaving does not.
   */
  const isTemp = () => !!params.id && !!useApp.chat(params.id)?.temp;
  createEffect(
    on(
      () => (isTemp() ? useApp.activeMessages().at(-1) : undefined),
      (last) => {
        if (last?.goto && last.goto !== params.id) navigate(`/chat/${last.goto}`);
      },
    ),
  );
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null);
  /** One of the human's own messages being edited in the composer, or null. Never outlives its chat. */
  const [editTarget, setEditTarget] = createSignal<string | null>(null);
  createEffect(on(() => params.id, () => setEditTarget(null), { defer: true }));
  const startEdit = (id: string) => {
    setReplyTarget(null);
    setEditTarget(id);
  };
  /** The words of the reply target the human picked to answer, with the target they belong to. */
  const [quote, setQuote] = createSignal<{ target: string; text: string } | null>(null);
  const replyQuote = () => {
    const q = quote();
    return q && q.target === replyTarget() ? q.text : undefined;
  };
  const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);
  /*
   * Unsent text and the reply target are saved per chat, and both come back from
   * memory in the same tick as the switch. `replyKey` is the chat the reply
   * signal currently belongs to, so a reply restored for one chat is never
   * saved under another.
   */
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
  /*
   * Reading the open room marks it read. The anchor for the unread divider is
   * frozen first, inside `markRead`, so the divider stays where it was.
   */
  createEffect(() => {
    const id = useApp.activeThreadId();
    if (id && useApp.hasUnread()) useApp.markRead(id);
  });
  const members = createMemo(() => new Map(useApp.members().map((member) => [member.id, member])));
  const messages = createMemo(() => useApp.activeMessages());
  /* "kiko joined", "piko left": one muted line each, placed by the room's sequence. */
  const notices = createMemo(() =>
    useApp.memberNotices().map((n) => ({ key: `${n.seq}`, seq: n.seq, at: n.at, text: `${n.name.toLowerCase()} ${n.kind}` })),
  );
  const byId = createMemo(
    () => new Map<string, ChatMessage>(messages().map((message) => [message.id, message])),
  );
  const replyTo = createMemo(() => {
    const id = replyTarget();
    return id === null ? null : (byId().get(id) ?? null);
  });

  /*
   * The transcript hands out its jump function instead of the app reaching into
   * it. The scroll and the landing highlight live in one place; a second path
   * would be a second place for them to disagree about where a message is.
   */
  let jumpToMessage: ((messageId: string) => void) | undefined;
  let scrollToLatest: (() => void) | undefined;

  /*
   * A search hit to land on (search/state.ts). It waits until its chat is the open one, then the
   * room makes the message part of the transcript (from the room when it is older than anything
   * held) and the same jump a reply quote uses scrolls to it and marks it; a second jump lands it
   * again once the rows are measured. While it lands, the scroller passing the end of the new, shorter
   * list is not the reader reaching the end, so it pages nothing in (`landing`).
   */
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
  /** Back to the newest message, leaving a window the reader jumped to. */
  const toLatest = () => {
    if (!useApp.showingHistory()) return scrollToLatest?.();
    useApp.goLive();
    requestAnimationFrame(() => scrollToLatest?.());
  };

  /*
   * `data-scrolled` means "away from the latest message", not "not at the top".
   * Reading it as `scrollOffset > 0` looked right and was backwards: the offset
   * is largest when the reader is at the BOTTOM of the thread, so the composer
   * raised its scrim over the newest messages — the one place it must never
   * appear. kat's attribute has the same meaning, which is why its composer is
   * flush at rest and lifts only once there is something to fade.
   */
  const scrolled = () => {
    const state = threadState();
    if (!state) return false;
    return state.scrollOffset + state.viewportSize < state.scrollSize - 1 || useApp.showingHistory();
  };

  /*
   * Telegram's @ button. The store keeps the mentions of you this visit has not shown yet; one on
   * screen counts as seen, and the button jumps to the oldest of the rest.
   */
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

  return (
    <>
    {/* The shell owns the row and the rail. The transcript pane keeps
       `data-component="chat-shell"`, the stable handle the verify skill scopes
       by, and keeps `min-w-0` so the column narrows with the window. */}
      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        data-component="chat-shell"
        data-reply-target={replyTarget() ?? undefined}
        data-range={threadState() ? `${threadState()!.rangeStart}-${threadState()!.rangeEnd}` : undefined}
      >
        {/* The wrapper has to be a flex column, not a plain block: the
            transcript's stage is `flex min-h-0 flex-1 flex-col` and both of
            those are inert unless its parent is a flex container. As a block
            the stage fell back to content height, the scroller inside never
            scrolled, and the transcript grew straight past the pane and
            rendered *behind* the composer. */}
        <div class="flex min-h-0 flex-1 flex-col" ref={transcript}>
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
            waitingDoing={useApp.typingDoing()}
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

        {/* The dock is in flow, not absolutely positioned: nothing between it
            and the viewport is a positioned ancestor, so `bottom: 0` would
            resolve against the window and the composer would span the whole
            page. The fade above it is the stylesheet's `::before`. */}
        <div
          class="composer-dock"
          data-component="composer-dock"
          data-scrolled={scrolled() ? "true" : undefined}
        >
          {/*
            kat's scroll-down control: a 34px circle floating just above the
            composer's right edge, where the send button is, rather than the
            pill this used to be in the middle of the transcript. It appears
            only when there is somewhere to go, so it never sits over the
            composer's own controls when the reader is already at the end.
          */}
          <Show when={scrolled()}>
            <button
              type="button"
              class="composer-scroll-down"
              data-component="composer-scroll-down"
              aria-label="scroll to latest"
              onClick={toLatest}
            >
              <IconV2 name="chevron-down" />
            </button>
          </Show>
          <Show when={mentions().length}>
            <button
              type="button"
              class="composer-jump-mention"
              data-component="composer-jump-mention"
              data-stacked={scrolled() ? "" : undefined}
              aria-label="next mention"
              onClick={jumpToMention}
            >
              <span aria-hidden="true">@</span>
              <span class="composer-jump-count" data-component="composer-jump-count">{mentions().length}</span>
            </button>
          </Show>
          <Show when={useApp.room()?.approvals().length ? useApp.room() : undefined}>
            {(r) => <ApprovalCards approvals={r().approvals()} onDecide={(id, action) => r().approve(id, action)} />}
          </Show>
          {/* The one place that says no model can run: the room's refusal, or no provider at all. */}
          <Show when={useApp.room()?.state.noProvider ?? (connectedReady() && connectedProviders().length === 0)}>
            {(np) => (
              <div
                class="mx-auto mb-2 flex w-full max-w-[720px] items-center gap-3 rounded-2xl bg-[oklch(from_var(--accent)_l_c_h_/_12%)] px-4 py-2.5 text-sm text-text"
                role="status"
                data-component="no-provider"
              >
                <span class="min-w-0 flex-1">
                  {typeof np() === "object"
                    ? `${(np() as { slug: string }).slug} can't reply yet: no ${(np() as { provider: string }).provider} key is connected.`
                    : "connect a provider so your agents can reply."}
                </span>
                <A href="/settings/models" class="shrink-0 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-[var(--on-accent)] no-underline">
                  connect
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
          {/* Who the first message goes to, picked right where it is written. Once a message is sent
              the chat is an ordinary chat, and people are added from its info panel. */}
          <Show when={isTemp() && messages().length === 0 && params.id}>
            {(id) => (
              <div class="mx-auto w-full max-w-[720px] pb-2">
                <ToBar roomId={id() as RoomId} />
              </div>
            )}
          </Show>
          <Composer
            threadId={useApp.activeThreadId() ?? ""}
            /* A temporary chat is still "new chat"; its composer names who will read the message. */
            title={isTemp() ? useApp.members().map((m) => m.name).join(", ") || "kiko" : useApp.chatById(useApp.activeThreadId() ?? "")?.name}
            draftKey={draftKey()}
            draftFor={(key) => book()?.get(key)?.text ?? ""}
            onDraftChange={(key, text) => {
              book()?.save(key, { text });
              if (text !== "") useApp.typing();
            }}
            bots={useApp.members()}
            /*
             * A send while a reply is armed is a REPLY, and the two store
             * mutations are different: `appendMessage` writes a root message
             * and drops the quote on the floor, which is exactly what it did —
             * the composer cleared its reply bar, so the quote vanished from
             * both surfaces while never reaching the transcript.
             */
            onSend={(message) => {
              const target = replyTarget();
              // A send from a window the reader jumped to lands at the live end, which renders first.
              const fromHistory = useApp.showingHistory();
              const sent =
                target === null
                  ? useApp.appendMessage(message)
                  : useApp.appendReply(message, target, replyQuote());
              // A temporary chat is named by its first message, so its tab stops reading "new chat".
              const id = params.id;
              if (sent !== undefined && id && isTemp() && messages().length <= 1) {
                const title = message.body.trim().replace(/\s+/g, " ").slice(0, 40).toLowerCase();
                if (title) useApp.user()?.rename(id as RoomId, title);
              }
              setQuote(null);
              /*
               * Sending is a statement about where you want to be looking. If
               * the reader had scrolled up and then sent, leaving them parked
               * mid-history means the message they just wrote is off-screen.
               *
               * `scrollToLatest`, NOT `jumpToMessage`: the latter also arms the
               * landing highlight, which is right when you clicked a quote to
               * go find a message and wrong here — it made every message the
               * reader sent flash on arrival.
               */
              if (sent !== undefined) (fromHistory ? requestAnimationFrame(() => scrollToLatest?.()) : scrollToLatest?.());
            }}
            replyTo={replyTo()}
            replyQuote={replyQuote()}
            onClearReply={() => (setReplyTarget(null), setQuote(null))}
            editing={editTarget() === null ? null : (byId().get(editTarget()!) ?? null)}
            onEdit={(id, text) => useApp.editMessage(id, text)}
            onCancelEdit={() => setEditTarget(null)}
            onEditLast={() => {
              // The newest stored text message the human wrote. Attachments alone have nothing to edit.
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
