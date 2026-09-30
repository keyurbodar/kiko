import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import "./styles/app.css";
import { useApp } from "./lib/store";
import type { ChatMessage } from "./lib/types";
import { MessageList, type VirtualThreadState } from "./chat/MessageList";

const root = document.getElementById("root");

if (!root) throw new Error("Root element #root not found");

/*
 * The composed app: the transcript over the store's real state, with the
 * fixtures as its only data source. The same props the harness passes, driven
 * from `useApp` instead of a fixture slice, so a difference between this page
 * and the harness is a difference in the data and never in the wiring.
 *
 * `chat.css` reaches the page through MessageList, not through an import here,
 * so the slice stays the owner of its own styles.
 *
 * The two signals are real state the shell writes to, surfaced as data
 * attributes so a devtools read can see what the transcript last reported. They
 * are not a stand-in for behaviour the shell does not have: the reply target is
 * only meaningful once the composer is mounted, and the unread cursor is null
 * here because the store has no read state to pass.
 */
export default function App() {
  const [replyTarget, setReplyTarget] = createSignal<string | null>(null);
  const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);

  const bots = useApp.botById();
  const messages = createMemo(() => useApp.activeMessages());
  const byId = createMemo(
    () => new Map<string, ChatMessage>(messages().map((message) => [message.id, message])),
  );

  return (
    <div class="app-shell">
      <div
        class="app-pane"
        data-component="chat-shell"
        data-reply-target={replyTarget() ?? undefined}
        data-range={threadState() ? `${threadState()!.rangeStart}-${threadState()!.rangeEnd}` : undefined}
      >
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
        />
      </div>
    </div>
  );
}

render(() => <App />, root);
