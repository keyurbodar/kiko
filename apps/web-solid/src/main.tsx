import { render } from "solid-js/web";
import "./styles/app.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element #root not found");

/*
 * Placeholder composition. The chat surface is rebuilt on the kat token layer
 * next phase; until then the shell exists so the app boots against the new
 * stylesheet chain.
 */
export default function App() {
  return (
    <div class="app-shell">
      <div class="chat-shell" data-component="chat-shell" />
    </div>
  );
}

render(() => <App />, root);
