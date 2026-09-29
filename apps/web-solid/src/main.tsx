import { createMemo } from "solid-js";
import { render } from "solid-js/web";
import { ThemeProvider } from "@kiko/ui";
import { WHIRL_THEME, applyThemePalette } from "@kiko/ui/app-theme";
import { VirtualThread } from "./chat/VirtualThread";
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
          scrollRef={() => {}}
          onStateChange={() => {}}
        />
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
