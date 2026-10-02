import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { useParams } from "@solidjs/router";
import { Icon as IconV2 } from "@kiko/ui/v2/icon";
import { MessageList, type VirtualThreadState } from "../../chat/MessageList";
import { Composer } from "../../composer/composer";
import { useApp } from "../../lib/store";
import type { ChatMessage } from "../../lib/types";

/*
 * The composed app: the transcript over the store's real state, with the
 * fixtures as its only data source. The same props the harness passes, driven
 * from `useApp` instead of a fixture slice, so a difference between this page
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
  createEffect(() => {
    const id = params.id;
    if (id && id !== useApp.activeThreadId()) useApp.selectThread(id);
  });
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null);
  const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);
  createEffect(
    on(useApp.activeThreadId, () => {
      setReplyTarget(null);
    }),
  );
  const bots = useApp.botById();
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
    /* The shell owns the row and the rail. The transcript pane keeps
       `data-component="chat-shell"`, the stable handle the verify skill scopes
       by, and keeps `min-w-0` so the column narrows with the window. */
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
            botById={(id) => (id === undefined ? undefined : bots.get(id))}
            replyParent={(id) => (id === undefined ? undefined : byId().get(id))}
            firstUnreadMessageId={null}
            onJumpToMessage={() => {}}
            onReplyTarget={setReplyTarget}
            scrollRef={() => {}}
            onStateChange={setThreadState}
            waitingNames={[]}
            replyTarget={replyTarget()}
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
            bots={useApp.bots()}
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
                  ? useApp.appendMessage(message, Date.now())
                  : useApp.appendReply(message, target, Date.now());
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
  );
}
