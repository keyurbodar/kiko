// Typing harness: one bubble per motion, alone and in a group, so every motion can be seen at once.
// `window.__typing` still exposes the real presence primitive for the browser checks.

import { render } from "solid-js/web";
import "../../styles/app.css";
import { createTypingPresence } from "./create-typing-presence";
import { TypingIndicator } from "./TypingIndicator";
import Moment from "../../mascot/moment";

const ROWS: [string[], (string | undefined)[]][] = [
  [["kiko"], []],
  [["scout"], ["reading /notes.md"]],
  [["scout"], ["reading a web page"]],
  [["editor"], ["editing /draft.md"]],
  [["budget"], ["running code on the human's connected apps"]],
  [["lead"], ["working with a helper"]],
  [["planner"], ["handling a reminder"]],
  [["kiko"], ["setting up agents"]],
  [["lead"], ["reading a web page"]],
  [["lead", "scout", "budget"], []],
  [["lead", "scout", "budget"], ["editing /plan.md", "reading a web page", undefined]],
];

function Page() {
  const presence = createTypingPresence();
  (window as unknown as { __typing: unknown }).__typing = presence;
  return (
    <div style={{ padding: "24px", background: "var(--bg)", "min-height": "100vh", color: "var(--text)", display: "flex", "flex-direction": "column", gap: "14px" }}>
      {ROWS.map(([typists, doing]) => (
        <TypingIndicator typists={typists} seeds={typists} doings={doing} group={typists.length > 1} />
      ))}
      <TypingIndicator typists={["kiko", "scout", "budget", "lead", "planner"]} doings={["editing /plan.md"]} group />
      <TypingIndicator typists={presence.typists()} />
      <div style={{ display: "flex", gap: "32px", "align-items": "flex-end" }}>
        <Moment kind="nothing" />
        <Moment kind="nest" faces={["planner"]} />
        <Moment kind="cheer" faces={["kiko", "scout", "budget"]} />
      </div>
    </div>
  );
}

render(() => <Page />, document.getElementById("root") as HTMLElement);
