import type { Agent, AgentSlug } from "@kiko/protocol"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, on, onMount, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { loadCatalog, modelRef } from "../settings/catalog"
import { chatModel } from "../settings/chat-model"
import { connectedProviders } from "../settings/connected"
import {
  agentList,
  agentProblem,
  chatTitle,
  cleanHandle,
  filterAgents,
  slugFromName,
} from "./new-chat-model"
import "./new-chat.css"

/*
 * The "to:" bar. Pick one agent and press Enter for a chat with it; pick several
 * and the bar asks for a group name, and the first one picked leads. Everything
 * is keyboard first and applies at once: the chat is in the sidebar before the
 * server hears of it.
 *
 *   arrows        move the highlight
 *   tab, click    add the highlighted agent to the bar
 *   enter         with nothing picked, chat with the highlighted agent; otherwise create
 *   backspace     in an empty search, remove the last one picked
 *   escape        close the form, or leave
 */
export function NewChat() {
  const navigate = useNavigate()
  const [query, setQuery] = createSignal("")
  const [picked, setPicked] = createSignal<Agent[]>([])
  const [groupName, setGroupName] = createSignal("")
  const [at, setAt] = createSignal(0)
  const [adding, setAdding] = createSignal(false)
  let search: HTMLInputElement | undefined

  const everyone = createMemo(() => agentList(useApp.agents()))
  const shown = createMemo(() => filterAgents(everyone(), query()))
  // Highlight stays inside the list as the list shrinks.
  createEffect(on(() => shown().length, (n) => setAt((i) => Math.min(i, Math.max(0, n - 1)))))
  createEffect(on(query, () => setAt(0), { defer: true }))

  const isPicked = (agent: Agent) => picked().some((p) => p.id === agent.id)
  const pick = (agent: Agent) => {
    setPicked((list) => (list.some((p) => p.id === agent.id) ? list.filter((p) => p.id !== agent.id) : [...list, agent]))
    setQuery("")
    search?.focus()
  }

  const create = (agents: readonly Agent[]) => {
    if (agents.length === 0) return
    const id = useApp.createChat(chatTitle(agents, groupName()), agents.map((a) => a.id))
    if (id) navigate(`/chat/${id}`)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const list = shown()
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      // The last stop is the "new agent" row, one past the agents.
      setAt((i) => Math.max(0, Math.min(list.length, i + step)))
    } else if (event.key === "Tab" && !event.shiftKey) {
      const agent = list[at()]
      if (!agent || at() >= list.length) return
      event.preventDefault()
      if (!isPicked(agent)) pick(agent)
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (at() === list.length) return setAdding(true)
      const agent = list[at()]
      if (picked().length > 0) create(picked())
      else if (agent) create([agent])
    } else if (event.key === "Backspace" && query() === "" && picked().length > 0) {
      setPicked((l) => l.slice(0, -1))
    } else if (event.key === "Escape") {
      event.preventDefault()
      navigate("/chat")
    }
  }

  onMount(() => search?.focus())

  return (
    <div class="new-chat" data-component="new-chat">
      <div class="new-chat-bar" data-component="new-chat-bar">
        <span class="new-chat-to">to:</span>
        <For each={picked()}>
          {(agent) => (
            <span class="new-chat-chip" data-component="new-chat-chip" data-slug={agent.slug}>
              <IdentityAvatar seed={agent.slug} size={18} />
              {agent.name}
              <button type="button" class="new-chat-chip-x" aria-label={`remove ${agent.name}`} onClick={() => pick(agent)}>
                ×
              </button>
            </span>
          )}
        </For>
        <Show when={picked().length > 1}>
          <input
            class="new-chat-group"
            data-component="new-chat-group"
            placeholder="group name"
            aria-label="group name"
            autocomplete="off"
            spellcheck={false}
            value={groupName()}
            onInput={(e) => setGroupName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                create(picked())
              } else if (e.key === "Escape") {
                e.preventDefault()
                search?.focus()
              }
            }}
          />
        </Show>
        <Show when={picked().length === 0}>
          <span class="new-chat-plus" aria-hidden="true">+</span>
          <span class="new-chat-hint">add someone to message</span>
        </Show>
      </div>

      <div class="new-chat-pop" data-component="new-chat-popover">
        <Show
          when={!adding()}
          fallback={
            <NewAgentForm
              existing={everyone()}
              onCancel={() => {
                setAdding(false)
                queueMicrotask(() => search?.focus())
              }}
              onCreated={(agent) => {
                setAdding(false)
                setPicked((l) => [...l, agent])
                queueMicrotask(() => search?.focus())
              }}
            />
          }
        >
          <label class="new-chat-search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              ref={(el) => (search = el)}
              data-component="new-chat-search"
              placeholder="name or @handle"
              aria-label="search agents"
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </label>

          <ul class="new-chat-list" role="listbox" aria-label="agents" data-component="new-chat-list">
            <For each={shown()} fallback={<li class="new-chat-empty">no agent matches</li>}>
              {(agent, i) => (
                <li
                  role="option"
                  class="new-chat-item"
                  data-component="new-chat-item"
                  data-slug={agent.slug}
                  data-active={at() === i() ? "" : undefined}
                  aria-selected={isPicked(agent)}
                  onMouseMove={() => setAt(i())}
                  onClick={() => pick(agent)}
                >
                  <IdentityAvatar seed={agent.slug} size={32} />
                  <span class="new-chat-names">
                    <span class="new-chat-name">{agent.name}</span>
                    <span class="new-chat-slug">@{agent.slug}</span>
                  </span>
                  <Show when={isPicked(agent)}>
                    <span class="new-chat-check" aria-hidden="true">added</span>
                  </Show>
                </li>
              )}
            </For>
            <li
              role="option"
              class="new-chat-item new-chat-new"
              data-component="new-chat-new-agent"
              data-active={at() === shown().length ? "" : undefined}
              aria-selected="false"
              onMouseMove={() => setAt(shown().length)}
              onClick={() => setAdding(true)}
            >
              <span class="new-chat-plus" aria-hidden="true">+</span>
              <span class="new-chat-name">new agent</span>
            </li>
          </ul>
          <Show when={picked().length > 0} fallback={<p class="new-chat-foot">search by name or @handle</p>}>
            <button type="button" class="new-chat-start" data-component="new-chat-start" onClick={() => create(picked())}>
              {picked().length > 1 ? `start group with ${picked().length}` : `start chat with ${picked()[0]!.name}`}
              <span class="new-chat-start-key" aria-hidden="true">enter</span>
            </button>
          </Show>
        </Show>
      </div>
    </div>
  )
}

/** The inline form. Name, a handle that follows the name until it is edited, one line on what it does, and the model. */
function NewAgentForm(props: { existing: readonly Agent[]; onCancel: () => void; onCreated: (agent: Agent) => void }) {
  const [name, setName] = createSignal("")
  const [handle, setHandle] = createSignal("")
  const [handleEdited, setHandleEdited] = createSignal(false)
  const [prompt, setPrompt] = createSignal("")
  const [model, setModel] = createSignal<string>(chatModel(null) ?? "")
  const [tried, setTried] = createSignal(false)
  let first: HTMLInputElement | undefined

  const [catalog] = createResource(loadCatalog)
  const groups = createMemo(() => {
    const providers = catalog()?.providers ?? []
    const connected = new Set(connectedProviders().map((p) => p.provider))
    const usable = connected.size ? providers.filter((p) => connected.has(p.id)) : providers
    return usable.map((p) => ({ id: p.id, name: p.name.toLowerCase(), models: p.models.map((m) => ({ ref: modelRef(p.id, m.id), name: m.name.toLowerCase() })) }))
  })
  // The default stays selected when the catalog holds it. Otherwise the first model is offered.
  createEffect(() => {
    const all = groups().flatMap((g) => g.models)
    if (all.length && !all.some((m) => m.ref === model())) setModel(all[0]!.ref)
  })

  const problem = () => agentProblem({ name: name(), handle: handle(), prompt: prompt(), model: model() }, props.existing)

  const submit = () => {
    if (problem()) return setTried(true)
    const agent: Agent = { id: crypto.randomUUID(), name: name().trim().toLowerCase(), slug: handle() as AgentSlug, prompt: prompt().trim(), model: model() }
    // Optimistic: it is in the list before the server answers.
    useApp.createAgent(agent)
    props.onCreated(agent)
  }

  onMount(() => first?.focus())

  return (
    <form
      class="new-chat-form"
      data-component="new-agent-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          props.onCancel()
        }
      }}
    >
      <p class="new-chat-form-title">new agent</p>
      <input
        ref={(el) => (first = el)}
        data-field="name"
        placeholder="name"
        aria-label="name"
        autocomplete="off"
        spellcheck={false}
        value={name()}
        onInput={(e) => {
          setName(e.currentTarget.value)
          if (!handleEdited()) setHandle(slugFromName(e.currentTarget.value))
        }}
      />
      <label class="new-chat-handle">
        <span>@</span>
        <input
          data-field="handle"
          placeholder="handle"
          aria-label="handle"
          autocomplete="off"
          spellcheck={false}
          value={handle()}
          onInput={(e) => {
            setHandleEdited(true)
            setHandle(cleanHandle(e.currentTarget.value))
          }}
        />
      </label>
      <input
        data-field="prompt"
        placeholder="what it does"
        aria-label="what it does"
        autocomplete="off"
        value={prompt()}
        onInput={(e) => setPrompt(e.currentTarget.value)}
      />
      <select data-field="model" aria-label="model" value={model()} onChange={(e) => setModel(e.currentTarget.value)}>
        <Show when={groups().length === 0}>
          <option value={model()}>{model() || "no model yet"}</option>
        </Show>
        <For each={groups()}>
          {(g) => (
            <optgroup label={g.name}>
              <For each={g.models}>{(m) => <option value={m.ref} selected={m.ref === model()}>{m.name}</option>}</For>
            </optgroup>
          )}
        </For>
      </select>
      <Show when={tried() && problem()}>
        <p class="new-chat-problem" data-component="new-agent-problem">{problem()}</p>
      </Show>
      <div class="new-chat-form-actions">
        <button type="button" class="new-chat-secondary" onClick={props.onCancel}>cancel</button>
        <button type="submit" class="new-chat-primary" data-component="new-agent-create">create</button>
      </div>
    </form>
  )
}
