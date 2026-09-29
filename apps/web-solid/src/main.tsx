import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ThemeProvider } from "@kiko/ui";
import { WHIRL_THEME, applyThemePalette } from "@kiko/ui/app-theme";
import { VirtualThread } from "./chat/VirtualThread";
import { Composer } from "./composer/composer";
import { useApp } from "./lib/store";
import { Sidebar } from "./sidebar/sidebar";
import "./styles/app.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element #root not found");

applyThemePalette(WHIRL_THEME);

const App = () => {
  const title = createMemo(() => {
    const id = useApp.activeThreadId();
    if (!id) return "Kiko";
    const bot = useApp.bots().find((entry) => entry.id === id);
    if (bot) return bot.name;
    return useApp.groups().find((entry) => entry.id === id)?.name ?? "Kiko";
  });

  const openThread = (threadId: string) => {
    useApp.selectThread(threadId);
    useApp.markRead(threadId);
  };

  /*
   * The transcript is virtualized, so a message appended to the end of the
   * list renders outside the viewport and the send looks like it did nothing.
   * The chat slice hands the scroller over through `scrollRef` for exactly
   * this, and scrolling to the full height is what brings the new row into
   * the virtualizer's window.
   *
   * One frame of delay: `appendMessage` has been applied by then, so the
   * spacer has grown and `scrollHeight` is the height of the list that
   * actually contains the new row.
   */
  const [scroller, setScroller] = createSignal<HTMLDivElement>();

  const showLatest = () => {
    const element = scroller();
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  };

  return (
    <div class="app-shell">
      <Sidebar
        bots={useApp.bots()}
        groups={useApp.groups()}
        activeThreadId={useApp.activeThreadId()}
        onSelectThread={openThread}
      />
      <div class="chat-shell">
        <header class="chat-topbar" data-component="chat-topbar">
          <span class="chat-topbar__title">{title()}</span>
          <span class="chat-topbar__count">{useApp.activeMessages().length} messages</span>
        </header>
        <VirtualThread
          messages={useApp.activeMessages()}
          botById={(botId) => (botId ? useApp.botById().get(botId) : undefined)}
          replyParent={(messageId) =>
            messageId ? useApp.messageById(messageId) : undefined
          }
          onToggleReaction={(messageId, emoji) => useApp.toggleReaction(messageId, emoji)}
          scrollRef={(element) => setScroller(element)}
          onStateChange={() => {}}
          waitingNames={useApp
            .bots()
            .filter((bot) => bot.presence === "typing" || bot.presence === "working")
            .map((bot) => bot.name)}
        />
        {/* Not wrapped in a busy flag: v1 sends optimistically and has no
            round trip to wait on, so the composer never disables itself. */}
        <div class="composer-dock">
          <Composer
            bots={useApp.bots()}
            threadId={useApp.activeThreadId() ?? ""}
            onSend={(body) => {
              useApp.appendMessage(body, Date.now());
              showLatest();
            }}
          />
        </div>
      </div>
    </div>
  );
};

render(
  () => (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  ),
  root,
);
