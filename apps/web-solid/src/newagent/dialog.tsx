import { cachedUri } from "@kiko/avatar/uri"
import { history, openChat } from "../app/history"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { user } from "../state/user"
import { Button, fieldClass } from "../settings/kit"
import { createAgent } from "./create"
import { faceOptions, MAX_DESCRIPTION, MAX_NAME, problems, ready, suggestHandle } from "./model"
import { closeNewAgent } from "./state"

export default function NewAgentDialog() {
  let nameInput: HTMLInputElement | undefined
  const [name, setName] = createSignal("")
  const [handle, setHandle] = createSignal("")
  const [handleEdited, setHandleEdited] = createSignal(false)
  const [description, setDescription] = createSignal("")
  const [options, setOptions] = createSignal(faceOptions())
  const [chosen, setChosen] = createSignal(0)
  const taken = () => user.agents().map((a) => ({ name: a.name, slug: a.slug }))
  const form = () => ({ name: name(), handle: handle(), description: description() })
  const issues = createMemo(() => problems(form(), taken()))
  const pins = () => options()[chosen()]!
  const seed = () => handle().trim().replace(/^@/, "") || "new-agent"
  const face = (index: number, size: number) => (
    <img src={cachedUri(seed(), options()[index]!)} alt="" width={size} height={size} draggable={false} />
  )

  onMount(() => requestAnimationFrame(() => nameInput?.focus()))

  const onName = (value: string) => {
    setName(value)
    if (!handleEdited()) setHandle(suggestHandle(value, taken()))
  }
  const shuffle = () => {
    setOptions(faceOptions())
    setChosen(1)
  }
  const create = (event?: SubmitEvent) => {
    event?.preventDefault()
    if (!ready(form(), taken())) return
    const here = history.location.href
    const roomId = createAgent(form(), pins(), () => history.replace(here))
    if (!roomId) return
    closeNewAgent()
    openChat(roomId)
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
            <span class="grid size-24 place-items-center rounded-composer bg-editor" data-part="preview">
              {face(chosen(), 80)}
            </span>
            <Button variant="ghost" data-action="shuffle-avatar" onClick={shuffle}>
              Shuffle
            </Button>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <label class="flex flex-col gap-1.5 text-xs text-tertiary">
              Name
              <input
                class={cn(fieldClass, issues().name && "shadow-[inset_0_0_0_1px_var(--text-danger)]")}
                name="name"
                placeholder="Scout"
                ref={nameInput}
                autocomplete="off"
                maxLength={MAX_NAME}
                value={name()}
                onInput={(event) => onName(event.currentTarget.value)}
              />
              <Show when={issues().name}>
                {(text) => (
                  <span class="text-danger" data-part="name-problem">
                    {text()}
                  </span>
                )}
              </Show>
            </label>
            <label class="flex flex-col gap-1.5 text-xs text-tertiary">
              Handle
              <span class="flex items-center gap-1">
                <span aria-hidden="true">@</span>
                <input
                  class={cn(
                    fieldClass,
                    "min-w-0 flex-1",
                    issues().handle && "shadow-[inset_0_0_0_1px_var(--text-danger)]",
                  )}
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
              <Show when={issues().handle}>
                {(text) => (
                  <span class="text-danger" data-part="handle-problem">
                    {text()}
                  </span>
                )}
              </Show>
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
                aria-label={index() === 0 ? "Face from the name" : `Face ${index() + 1}`}
                class="grid aspect-square place-items-center rounded-xl outline-none transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-tertiary active:scale-(--press-scale) aria-checked:bg-secondary"
                onClick={() => setChosen(index())}
              >
                {face(index(), 32)}
              </button>
            )}
          </For>
        </div>
        <label class="flex flex-col gap-1.5 text-xs text-tertiary">
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
