// Typing indicator harness. `window.__typing` exposes the real presence
// primitive so a browser can ping, send and clear through the same path the
// app uses.

import { render } from "solid-js/web";
import "../../styles/app.css";
import { createTypingPresence } from "./create-typing-presence";
import { TypingIndicator } from "./TypingIndicator";

function Page() {
  const presence = createTypingPresence();
  (window as unknown as { __typing: unknown }).__typing = presence;
  return (
    <div style={{ padding: "24px", background: "var(--bg)", "min-height": "100vh", color: "var(--text)" }}>
      <TypingIndicator typists={presence.typists()} sending={presence.sending()} />
    </div>
  );
}

render(() => <Page />, document.getElementById("root") as HTMLElement);
