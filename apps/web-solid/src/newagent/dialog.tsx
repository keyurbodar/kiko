import { cachedUri } from "@kiko/avatar/uri"
import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { useApp } from "../lib/store"
import { Button, fieldClass } from "../settings/kit"
import { createAgent } from "./create"
import { MAX_DESCRIPTION, MAX_NAME, problems, ready, shufflePins, suggestHandle } from "./model"
import { closeNewAgent } from "./state"

const CANDIDATES = 8
const candidates = () => Array.from({ length: CANDIDATES }, () => shufflePins())

/*
 * The new agent form: a name, a handle, a face, and what it should do. Create opens the agent's own chat at
 * once, and the agent speaks first. Lazy: loaded the first time it opens.
 */
export default function NewAgentDialog() {
  let nameInput: HTMLInputElement | undefined
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = createSignal("")
  const [handle, setHandle] = createSignal("")
  const [handleEdited, setHandleEdited] = createSignal(false)
  const [description, setDescription] = createSignal("")
  const [options, setOptions] = createSignal(candidates())
  const [chosen, setChosen] = createSignal(0)
  const taken = () => useApp.agents().map((a) => ({ name: a.name, slug: a.slug }))
  const form = () => ({ name: name(), handle: handle(), description: description() })
  const issues = createMemo(() => problems(form(), taken()))
  const pins = () => options()[chosen()]!
  const seed = () => handle().trim().replace(/^@/, "") || "new-agent"
  const face = (index: number, size: number) => <img src={cachedUri(seed(), options()[index]!)} alt="" width={size} height={size} draggable={false} />

  onMount(() => requestAnimationFrame(() => nameInput?.focus()))

  const onName = (value: string) => {
    setName(value)
    if (!handleEdited()) setHandle(suggestHandle(value, taken()))
  }
  const shuffle = () => {
    setOptions(candidates())
    setChosen(0)
  }
  const create = (event?: SubmitEvent) => {
    event?.preventDefault()
    if (!ready(form(), taken())) return
    const here = location.pathname + location.search
    const roomId = createAgent(form(), pins(), () => navigate(here))
    if (!roomId) return
    closeNewAgent()
    navigate(`/chat/${roomId}`)
  }

  return (
    <Dialog
      open
      onClose={closeNewAgent}
      title="New agent"
      description="Give it a name, a face, and a job. It will say hi first."
      data-component="new-agent"
      onSubmit={create}
      footer={
        <>
          <Button variant="ghost" onClick={closeNewAgent}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" data-action="create-agent" disabled={!ready(form(), taken())}>
            Create
          </Button>
        </>
      }
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-4">
          <div class="flex shrink-0 flex-col items-center gap-2">
            <span class="grid size-24 place-items-center rounded-2xl bg-[var(--control)]" data-part="preview">
              {face(chosen(), 80)}
            </span>
            <Button variant="ghost" data-action="shuffle-avatar" onClick={shuffle}>
              Shuffle
            </Button>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <label class="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Name
              <input
                class={cn(fieldClass, issues().name && "border-destructive")}
                name="name"
                placeholder="Scout"
                ref={nameInput}
                autocomplete="off"
                maxLength={MAX_NAME}
                value={name()}
                onInput={(event) => onName(event.currentTarget.value)}
              />
              <Show when={issues().name}>{(text) => <span class="text-destructive" data-part="name-problem">{text()}</span>}</Show>
            </label>
            <label class="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Handle
              <span class="flex items-center gap-1">
                <span aria-hidden="true">@</span>
                <input
                  class={cn(fieldClass, "min-w-0 flex-1", issues().handle && "border-destructive")}
                  name="handle"
                  autocomplete="off"
                  spellcheck={false}
                  maxLength={32}
                  value={handle()}
                  onInput={(event) => {
                    setHandleEdited(true)
                    setHandle(event.currentTarget.value)
                  }}
                />
              </span>
              <Show when={issues().handle}>{(text) => <span class="text-destructive" data-part="handle-problem">{text()}</span>}</Show>
            </label>
          </div>
        </div>
        <div class="grid grid-cols-8 gap-1" role="radiogroup" aria-label="Face">
          <For each={options()}>
            {(_, index) => (
              <button
                type="button"
                role="radio"
                aria-checked={chosen() === index()}
                aria-label={`Face ${index() + 1}`}
                class="grid aspect-square place-items-center rounded-xl outline-none hover:bg-[var(--control)] aria-checked:bg-[var(--ring-wash)] aria-checked:shadow-[inset_0_0_0_1px_var(--ring)]"
                onClick={() => setChosen(index())}
              >
                {face(index(), 32)}
              </button>
            )}
          </For>
        </div>
        <label class="flex flex-col gap-1.5 text-xs text-muted-foreground">
          What should it do?
          <textarea
            class={cn(fieldClass, "min-h-24 resize-none")}
            name="description"
            placeholder="Watches apartment listings and texts me when a new one fits."
            rows={4}
            maxLength={MAX_DESCRIPTION}
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) create()
            }}
          />
        </label>
      </div>
    </Dialog>
  )
}
