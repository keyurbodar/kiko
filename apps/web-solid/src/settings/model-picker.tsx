import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon } from "@kiko/ui/icons"
import { createSignal, onCleanup, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { user } from "../state/user"
import { defaultThinking, THINKING_LABELS, type ThinkingLevel } from "@kiko/protocol"
import { answeringMember, canReason } from "./agent-model"
import { ReasoningMenu } from "./reasoning-menu"
import { useLiveModel } from "./catalog"
import { connectedProviders } from "./connected"
import { hasModelProvider } from "./provider-kinds"
import { shortModelName } from "./model-list"
import ModelPickerPanel from "./model-picker-panel"
import { ModelSheet } from "./model-sheet"
import "./model-picker.css"
import { afterFirstPaint } from "../lib/motion"

const [pickerOpen, setPickerOpen] = createSignal(false)
const [pickerFor, setPickerFor] = createSignal<string | null>(null)
export const openModelPicker = (slug?: string) => {
  setPickerFor(slug ?? null)
  setPickerOpen(true)
}
const changePicker = (open: boolean) => {
  if (!open) setPickerFor(null)
  setPickerOpen(open)
}

export function ModelPicker(props: {
  current?: string
  onPick: (ref: string, thinking: readonly ThinkingLevel[], name: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  children: JSX.Element
  class?: string
  title?: string
}) {
  let trigger: HTMLButtonElement | undefined
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={cn("picker-trigger", props.class)}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        title={props.title}
        data-component="model-picker-button"
        onClick={() => props.onOpenChange(!props.open)}
      >
        {props.children}
      </button>
      <Show when={props.open}>
        <Suspense>
          <ModelPickerPanel
            current={props.current}
            onPick={props.onPick}
            onOpenChange={props.onOpenChange}
            trigger={() => trigger}
          />
        </Suspense>
      </Show>
    </>
  )
}

function usePhone() {
  const query = matchMedia("(width < 480px)")
  const [phone, setPhone] = createSignal(query.matches)
  const change = () => setPhone(query.matches)
  query.addEventListener("change", change)
  onCleanup(() => query.removeEventListener("change", change))
  return phone
}

const CHIP =
  "picker-trigger flex h-chip min-w-0 max-w-full items-center gap-1.5 rounded-control px-2 text-label text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"

export function ModelPickerButton(props: { draft: string }) {
  const members = () => room.roomMembers()
  const phone = usePhone()
  const painted = afterFirstPaint()
  const target = () => members().find((m) => m.slug === pickerFor()) ?? answeringMember(members(), props.draft)
  return (
    <Show when={hasModelProvider(connectedProviders()) ? target() : undefined}>
      {(member) => {
        const current = useLiveModel(() => user.agentModel(member().slug))
        const label = () => current()?.name ?? current()?.model.split("/").slice(1).join("/") ?? "Choose model"
        const thinking = () => {
          const levels = current()?.thinkingLevels
          return canReason(levels) ? THINKING_LABELS[current()?.thinking ?? defaultThinking(levels ?? [])] : null
        }
        const pick = (ref: string, levels: readonly ThinkingLevel[], name: string) =>
          ref !== current()?.model && room.setAgentModel(member().slug, { ref, levels, name })
        const setThinking = (level: ThinkingLevel) => room.setAgentModel(member().slug, { thinking: level })
        return (
          <Show
            when={!phone()}
            fallback={
              <>
                <button
                  type="button"
                  class={CHIP}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen()}
                  aria-label={`Model ${label()}${thinking() ? `, thinking ${thinking()}` : ""}`}
                  data-component="model-picker-button"
                  data-compact=""
                  onClick={() => changePicker(!pickerOpen())}
                >
                  <span class="model-chip">
                    <Show when={current()?.model.split("/")[0]}>
                      {(provider) => <ProviderIcon id={provider()} width="14" height="14" />}
                    </Show>
                    <span class="truncate" data-component="composer-model">
                      {shortModelName(label())}
                      <Show when={thinking()}>{(words) => `, ${words()}`}</Show>
                    </span>
                  </span>
                </button>
                <Show when={pickerOpen()}>
                  <ModelSheet
                    current={current()?.model}
                    levels={current()?.thinkingLevels}
                    value={current()?.thinking}
                    onPick={pick}
                    onThinking={setThinking}
                    onClose={() => changePicker(false)}
                  />
                </Show>
              </>
            }
          >
            <ModelPicker
              current={current()?.model}
              open={pickerOpen()}
              onOpenChange={changePicker}
              onPick={pick}
              title={members().length > 1 ? `Choose model for ${member().name}` : "Choose model"}
              class="flex h-7 max-w-[240px] min-w-0 items-center gap-1.5 rounded-control px-2 text-label text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
            >
              <Show when={members().length > 1}>
                <IdentityAvatar seed={member().slug} size={14} />
              </Show>
              <Show when={current()?.model.split("/")[0]} keyed>
                {(provider) => (
                  <span class="picker-swap" data-enter={painted() ? "" : undefined}>
                    <ProviderIcon id={provider} width="13" height="13" />
                  </span>
                )}
              </Show>
              <Show when={label()} keyed>
                {(text) => (
                  <span class="picker-swap min-w-0" data-slide="" data-enter={painted() ? "" : undefined}>
                    <span class="truncate" data-component="composer-model">
                      {text}
                    </span>
                  </span>
                )}
              </Show>
              <RemixIcon icon={ChevronDownIcon} size={10} class="picker-chevron shrink-0" />
            </ModelPicker>
            <ReasoningMenu levels={current()?.thinkingLevels} value={current()?.thinking} onChange={setThinking} />
          </Show>
        )
      }}
    </Show>
  )
}
