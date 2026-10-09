// The scenes, alone: the empty chat's snow day, the sidebar header, and the composer's snowball,
// drawn by the real components with no account and no data. Open /src/mascot/harness.html on the
// dev server. `?mode=light` or `?mode=dark` picks the appearance.

import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Snowball } from "../composer/snowball"
import "../styles/app.css"
import "../composer/composer.css"
import { EmptyState } from "../chat/ui/EmptyState"
import { HeaderSnow } from "../sidebar/header-snow"
import { BrandBird } from "./brand"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"

const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light"
applyCommitted({ ...DEFAULT_LOOK, mode })

function Board() {
  // The composer's snowball: an agent starts working a second in, and its reply lands at twelve.
  const [working, setWorking] = createSignal<string | null>(null)
  setTimeout(() => setWorking("yuki"), 1000)
  setTimeout(() => setWorking(null), 12000)
  let dock: HTMLDivElement | undefined
  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <aside style={{ position: "relative", width: "264px", background: "var(--bg-sidebar)", "border-right": "1px solid var(--hairline)" }}>
        <HeaderSnow />
        <div style={{ position: "relative", display: "flex", "align-items": "center", gap: "8px", padding: "12px 14px", "font-weight": "600", "font-size": "14px" }}>
          <BrandBird size={22} />
          Yuki
        </div>
        <div style={{ position: "relative", margin: "4px 8px", height: "32px", "border-radius": "9px", background: "var(--input-bg)", color: "var(--text-faint)", "font-size": "13px", display: "flex", "align-items": "center", padding: "0 10px" }}>Search</div>
      </aside>
      <div style={{ position: "relative", display: "flex", "flex-direction": "column", "justify-content": "center", flex: "1", "min-width": "0" }} data-component="chat-shell" data-session-empty="true">
        <EmptyState faces={["yuki"]} names={[]} />
        <div class="composer-dock" ref={dock}>
          <Snowball slug={working()} dock={() => dock} />
          <div class="composer-row">
            <div class="composer-input-wrap">
              <div class="composer-input" />
              <div class="composer-placeholder">Message Yuki</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

render(() => <Board />, document.getElementById("root")!)
