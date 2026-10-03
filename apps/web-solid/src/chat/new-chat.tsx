import type { Agent } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onMount } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { agentList } from "./new-chat-model"
import "./new-chat.css"

/*
 * A new chat (architecture section 7.11). The human never fills in a form: "ask kiko" opens a draft
 * where kiko asks what they want and makes the right agent, and "create group" opens one where
 * kiko puts a team together. A draft is not in the sidebar until kiko makes it a group; a new
 * agent's own chat opens when it is made. Below, any agent the human has is one click from a chat.
 *
 *   enter          ask kiko
 *   arrows         move between the choices and the agents
 *   escape         leave
 */
export function NewChat() {
  const navigate = useNavigate()
  const agents = createMemo(() => agentList(useApp.agents()))
  const [at, setAt] = createSignal(0)
  let root: HTMLDivElement | undefined

  const draft = (kind: "ask" | "group") => {
    const id = useApp.createDraft(kind)
    if (id) navigate(`/chat/${id}`)
  }
  const chatWith = (agent: Agent) => {
    const id = useApp.createChat(agent.name, [agent.id])
    if (id) navigate(`/chat/${id}`)
  }
  const choices = () => 2 + agents().length
  const run = (i: number) => (i === 0 ? draft("ask") : i === 1 ? draft("group") : chatWith(agents()[i - 2]!))

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setAt((i) => Math.max(0, Math.min(choices() - 1, i + (event.key === "ArrowDown" ? 1 : -1))))
    } else if (event.key === "Enter") {
      event.preventDefault()
      run(at())
    } else if (event.key === "Escape") {
      event.preventDefault()
      navigate("/chat")
    }
  }

  onMount(() => root?.focus())

  return (
    <div class="new-chat" data-component="new-chat" tabIndex={-1} ref={(el) => (root = el)} onKeyDown={onKeyDown}>
      <div class="new-chat-choices">
        <button type="button" class="new-chat-choice" data-action="ask-kiko" data-active={at() === 0 ? "" : undefined} onMouseMove={() => setAt(0)} onClick={() => draft("ask")}>
          <IdentityAvatar seed="kiko" size={40} />
          <span class="new-chat-names">
            <span class="new-chat-name">ask kiko</span>
            <span class="new-chat-slug">say what you need. kiko makes the right agent for it.</span>
          </span>
          <span class="new-chat-start-key" aria-hidden="true">enter</span>
        </button>
        <button type="button" class="new-chat-choice" data-action="create-group" data-active={at() === 1 ? "" : undefined} onMouseMove={() => setAt(1)} onClick={() => draft("group")}>
          <span class="new-chat-group-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="11.5" cy="7" r="2" />
              <path d="M1.5 14c.5-2.5 2.3-4 4.5-4s4 1.5 4.5 4M10 10.2c.5-.2 1-.2 1.5-.2 1.7 0 3 1.2 3.5 3" />
            </svg>
          </span>
          <span class="new-chat-names">
            <span class="new-chat-name">create group</span>
            <span class="new-chat-slug">tell kiko the goal. it puts a team together.</span>
          </span>
        </button>
      </div>
      <p class="new-chat-foot">or message one of yours</p>
      <ul class="new-chat-list" role="listbox" aria-label="agents" data-component="new-chat-list">
        <For each={agents()}>
          {(agent, i) => (
            <li
              role="option"
              class="new-chat-item"
              data-component="new-chat-item"
              data-slug={agent.slug}
              data-active={at() === i() + 2 ? "" : undefined}
              aria-selected="false"
              onMouseMove={() => setAt(i() + 2)}
              onClick={() => chatWith(agent)}
            >
              <IdentityAvatar seed={agent.slug} size={32} />
              <span class="new-chat-names">
                <span class="new-chat-name">{agent.name}</span>
                <span class="new-chat-slug">@{agent.slug}</span>
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
