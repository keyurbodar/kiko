import { createSignal, For, Show, createEffect, on, onCleanup } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon, HelpIcon } from "@kiko/ui/icons"
import { CollapsibleV2 as Collapsible } from "@kiko/ui/v2/collapsible-v2"
import { ToggleGroupV2 as ToggleGroup } from "@kiko/ui/v2/toggle-group-v2"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import type { QuestionInput } from "./question-input"
import "./question-panel.css"

export function QuestionPanel(props: {
  input: QuestionInput
  owner?: string
  ownerSeed?: string
  onSelect: (value: string) => void
}) {
  const p = props.input.progress
  const [open, setOpen] = createSignal(true)
  createEffect(
    on(
      () => `${props.input.ask()?.id}:${p().activeQuestion?.id}`,
      () => setOpen(true),
    ),
  )
  const select = (value: string) => props.onSelect(value)
  const shortcut = (e: KeyboardEvent) => {
    const target = e.target
    if (
      !open() ||
      e.defaultPrevented ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') ||
      (target instanceof HTMLElement &&
        target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])'))
    )
      return
    if (!/^[1-9]$/.test(e.key)) return
    const option = p().activeQuestion?.options[Number(e.key) - 1]
    if (option) {
      e.preventDefault()
      select(option.value ?? option.label)
    }
  }
  document.addEventListener("keydown", shortcut)
  onCleanup(() => document.removeEventListener("keydown", shortcut))
  return (
    <Show when={p().activeQuestion}>
      {(q) => (
        <Collapsible open={open()} onOpenChange={setOpen} data-component="question-panel">
          <div class="question-header">
            <Collapsible.Trigger
              class="composer-card-row"
              data-pending-user-input-toggle={open() ? "expanded" : "collapsed"}
              title={open() ? "Hide the question and its options" : "Show the question and its options"}
            >
              <span class="composer-card-icon">
                <Show when={props.ownerSeed} fallback={<RemixIcon icon={HelpIcon} />}>
                  {(seed) => <IdentityAvatar seed={seed()} size={18} />}
                </Show>
              </span>
              <span class="composer-card-title">
                <span class="composer-card-kind font-medium">
                  {q().header}
                  <Show when={props.owner}> · {props.owner}</Show>
                </span>
                <Show when={!open()}>
                  <span class="truncate">{q().question}</span>
                </Show>
              </span>
              <span class="composer-card-actions">
                <Show when={(props.input.ask()?.questions?.length ?? 1) > 1}>
                  <span>
                    {p().questionIndex + 1}/{props.input.ask()?.questions?.length}
                  </span>
                </Show>
                <RemixIcon icon={ChevronDownIcon} class="composer-card-toggle" />
              </span>
            </Collapsible.Trigger>
            <button
              type="button"
              class="question-dismiss"
              onClick={props.input.skip}
              aria-label="Skip questions without answering"
              title="Skip questions without answering"
            >
              <RemixIcon icon={CloseIcon} />
            </button>
          </div>
          <Collapsible.Content class="motion-collapse">
            <div class="composer-card-body question-body" data-component="question-body">
              <p>{q().question}</p>
              <Show when={q().multiSelect}>
                <p class="question-hint">Select one or more options.</p>
              </Show>
              <Show
                when={q().multiSelect}
                fallback={
                  <ToggleGroup
                    value={p().usingCustomAnswer ? "" : (p().selectedOptionValues[0] ?? "")}
                    onChange={(value: string | null) => {
                      if (value !== null) select(value)
                    }}
                    class="question-options"
                    aria-label={q().question}
                  >
                    <For each={q().options}>
                      {(option, index) => (
                        <ToggleGroup.Item value={option.value ?? option.label} class="question-option">
                          <Option
                            option={option}
                            index={index()}
                            selected={
                              !p().usingCustomAnswer && p().selectedOptionValues.includes(option.value ?? option.label)
                            }
                          />
                        </ToggleGroup.Item>
                      )}
                    </For>
                  </ToggleGroup>
                }
              >
                <ToggleGroup
                  multiple
                  value={p().usingCustomAnswer ? [] : p().selectedOptionValues}
                  onChange={(values: string[]) => {
                    const changed = [...new Set([...values, ...p().selectedOptionValues])].find(
                      (v) => values.includes(v) !== p().selectedOptionValues.includes(v),
                    )
                    if (changed !== undefined) select(changed)
                  }}
                  class="question-options"
                  aria-label={q().question}
                >
                  <For each={q().options}>
                    {(option, index) => (
                      <ToggleGroup.Item value={option.value ?? option.label} class="question-option">
                        <Option
                          option={option}
                          index={index()}
                          selected={
                            !p().usingCustomAnswer && p().selectedOptionValues.includes(option.value ?? option.label)
                          }
                        />
                      </ToggleGroup.Item>
                    )}
                  </For>
                </ToggleGroup>
              </Show>
            </div>
            <div class="question-primary-actions" data-component="question-actions">
              <Show when={p().questionIndex > 0}>
                <button
                  type="button"
                  class="question-previous"
                  onClick={props.input.previous}
                  aria-label="Previous question"
                >
                  <RemixIcon icon={ChevronLeftIcon} />
                  <span class="question-action-full">Previous</span>
                </button>
              </Show>
              <button
                type="button"
                class="question-submit"
                disabled={p().isLastQuestion ? !p().isComplete : !p().canAdvance}
                onClick={props.input.advance}
              >
                <span class="question-action-full">
                  {p().isLastQuestion ? (p().questionIndex > 0 ? "Submit answers" : "Submit answer") : "Next question"}
                </span>
                <span class="question-action-compact">{p().isLastQuestion ? "Submit" : "Next"}</span>
              </button>
            </div>
          </Collapsible.Content>
        </Collapsible>
      )}
    </Show>
  )
}

function Option(props: { option: { label: string; description?: string }; index: number; selected: boolean }) {
  return (
    <>
      <span class="question-option-copy">
        <span>{props.option.label}</span>
        <Show when={props.option.description && props.option.description !== props.option.label}>
          <span class="question-description">{props.option.description}</span>
        </Show>
      </span>
      <Show when={props.selected} fallback={<kbd>{props.index + 1}</kbd>}>
        <RemixIcon icon={CheckIcon} class="question-check" />
      </Show>
    </>
  )
}
