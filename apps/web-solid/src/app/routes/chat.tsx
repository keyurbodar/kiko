import { Show, createEffect, createMemo, createSignal, lazy, on } from "solid-js";
import { useLocation, useParams } from "@solidjs/router";
import { Icon as IconV2 } from "@kiko/ui/v2/icon";
import { MessageList, type VirtualThreadState } from "../../chat/MessageList";
import { Composer } from "../../composer/composer";
import { useApp } from "../../lib/store";
import type { MessageId } from "@kiko/protocol";
import type { ChatMessage } from "../../lib/types";

// The "to:" bar loads when `/chat/new` is first opened, not with the transcript.
const NewChat = lazy(() => import("../../chat/new-chat").then((m) => ({ default: m.NewChat })));

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
   * The URL names the open chat. `/chat/:id` selects that thread in the store;
   * `/chat` and `/chat/new` leave the selection alone. The store still holds
   * the selection because the transcript reads it from there, but the URL is
   * what changes it.
   */
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  /* `/chat/new` is the "to:" bar. It stands in for the thread until a chat is made. */
  const isNew = () => location.pathname === "/chat/new";
  createEffect(() => {
    const id = params.id;
    if (id && id !== useApp.activeThreadId()) useApp.selectThread(id);
  });
  /*
   * Opening a chat puts the cursor in the composer, the way kat and Telegram do, so the
   * next keystroke is a message. Not on a touch screen, where focus raises the keyboard
   * over the transcript, and not while the reader is typing somewhere else.
   */
  createEffect(
    on(
      () => (isNew() ? null : params.id),
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
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null);
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
    return state.scrollOffset + state.viewportSize < state.scrollSize - 1;
  };

  return (
    <Show when={!isNew()} fallback={<NewChat />}>
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
        <div class="flex min-h-0 flex-1 flex-col">
          <MessageList
            messages={messages()}
            botById={(id) => (id === undefined ? undefined : members().get(id))}
            replyParent={(id) => (id === undefined ? undefined : byId().get(id))}
            firstUnreadMessageId={useApp.firstUnreadMessageId()}
            onJumpToMessage={() => {}}
            onReplyTarget={setReplyTarget}
            scrollRef={() => {}}
            onStateChange={setThreadState}
            waitingNames={useApp.typingNames()}
            groupChat={members().size > 1}
            onReact={useApp.toggleReaction}
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
              onClick={() => scrollToLatest?.()}
            >
              <IconV2 name="chevron-down" />
            </button>
          </Show>
          <Composer
            threadId={useApp.activeThreadId() ?? ""}
            title={useApp.chatById(useApp.activeThreadId() ?? "")?.name}
            draftKey={draftKey()}
            draftFor={(key) => book()?.get(key)?.text ?? ""}
            onDraftChange={(key, text) => book()?.save(key, { text })}
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
              const sent =
                target === null
                  ? useApp.appendMessage(message)
                  : useApp.appendReply(message, target);
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
              if (sent !== undefined) scrollToLatest?.();
            }}
            replyTo={replyTo()}
            onClearReply={() => setReplyTarget(null)}
            onJumpToReply={(messageId) => jumpToMessage?.(messageId)}
          />
        </div>
      </div>
    </Show>
  );
}
