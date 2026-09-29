import { createMemo, For } from "solid-js";
import { render } from "solid-js/web";
import { ThemeProvider } from "@kiko/ui";
import { WHIRL_THEME, applyThemePalette } from "@kiko/ui/app-theme";
import { useApp } from "./lib/store";
import type { RosterBot, RosterGroup } from "./lib/types";
import { VirtualThread } from "./chat/VirtualThread";
import "./styles/app.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element #root not found");

applyThemePalette(WHIRL_THEME);

const App = () => {
  const threads = createMemo(() => {
    const bots = useApp.bots().map((bot: RosterBot) => ({ id: bot.id, name: bot.name }));
    const groups = useApp.groups().map((group: RosterGroup) => ({
      id: group.id,
      name: group.name,
    }));
    return [...bots, ...groups];
  });

  const title = createMemo(
    () => threads().find((thread) => thread.id === useApp.activeThreadId())?.name ?? "Kiko",
  );

  return (
    <div class="chat-shell">
      <header class="chat-topbar" data-component="chat-topbar">
        <span class="chat-topbar__title">{title()}</span>
        <span class="chat-topbar__count">{useApp.activeMessages().length} messages</span>
        <nav class="chat-switch" data-component="chat-switch">
          <For each={threads()}>
            {(thread) => (
              <button
                type="button"
                class="chat-switch__item"
                aria-pressed={useApp.activeThreadId() === thread.id}
                onClick={() => useApp.selectThread(thread.id)}
              >
                {thread.name}
              </button>
            )}
          </For>
        </nav>
      </header>

      <VirtualThread
        messages={useApp.activeMessages()}
        botById={(botId) => (botId ? useApp.botById().get(botId) : undefined)}
        replyParent={(messageId) => (messageId ? useApp.messageById(messageId) : undefined)}
        onToggleReaction={(messageId, emoji) => useApp.toggleReaction(messageId, emoji)}
        scrollRef={() => {}}
        onStateChange={() => {}}
        waitingNames={useApp
          .bots()
          .filter((bot) => bot.presence === "typing" || bot.presence === "working")
          .map((bot) => bot.name)}
      />
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
