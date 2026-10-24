import { onCleanup } from "solid-js"
import { KIKO_HOME_ROOM } from "@kiko/protocol"
import { user } from "../../state/user"
import { openChat } from "../history"
import { primary } from "./controls"
import { move, setFinished } from "./progress"

function focusComposer(tries = 40): void {
  const editor = document.querySelector<HTMLElement>(".composer-dock .ProseMirror")
  if (editor) editor.focus()
  else if (tries > 0) setTimeout(() => focusComposer(tries - 1), 50)
}

export function DoneStep() {
  onCleanup(() => setFinished(false))
  const open = () => {
    move("next")
    openChat(user.kikoChatId() ?? KIKO_HOME_ROOM, { replace: true })
    focusComposer()
  }
  return (
    <div class="welcome-step ob-done" data-step="done">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Your team is awake.
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Kiko is ready. Say hi, or ask for anything.
      </p>
      <div class="ob-cta" style={{ "--i": 2 }}>
        <button
          type="button"
          class={primary}
          data-cta
          data-action="open-kiko"
          ref={(el) => queueMicrotask(() => el.focus())}
          onClick={open}
        >
          Open Kiko
        </button>
      </div>
    </div>
  )
}
