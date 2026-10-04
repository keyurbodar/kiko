// Presence row harness: one row per act, plus a group, so every pixel act can be seen at once.
// `window.__typing` still exposes the real presence primitive for the browser checks.

import { render } from "solid-js/web";
import "../../styles/app.css";
import { createTypingPresence } from "./create-typing-presence";
import { TypingIndicator } from "./TypingIndicator";

const ROWS: [string[], string | undefined][] = [
  [["kiko"], undefined],
  [["scout"], "reading /notes.md"],
  [["scout"], "reading a web page"],
  [["editor"], "editing /draft.md"],
  [["budget"], "running code on the human's connected apps"],
  [["lead"], "working with a helper"],
  [["planner"], "handling a reminder"],
  [["kiko"], "setting up agents"],
  [["lead", "scout", "budget"], undefined],
];

function Page() {
  const presence = createTypingPresence();
  (window as unknown as { __typing: unknown }).__typing = presence;
  return (
    <div style={{ padding: "24px", background: "var(--bg)", "min-height": "100vh", color: "var(--text)", display: "flex", "flex-direction": "column", gap: "14px" }}>
      {ROWS.map(([typists, doing]) => (
        <TypingIndicator typists={typists} seeds={typists} doing={doing} />
      ))}
      <TypingIndicator typists={presence.typists()} sending={presence.sending()} />
    </div>
  );
}

render(() => <Page />, document.getElementById("root") as HTMLElement);
