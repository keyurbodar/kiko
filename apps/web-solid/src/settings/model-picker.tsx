import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon } from "@kiko/ui/icons"
import { createSignal, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { user } from "../state/user"
import type { ThinkingLevel } from "@kiko/protocol"
import { answeringMember } from "./agent-model"
import { ReasoningMenu } from "./reasoning-menu"
import { connectedProviders } from "./connected"
import { hasModelProvider } from "./provider-kinds"
import ModelPickerPanel from "./model-picker-panel"
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
  onPick: (ref: string, thinking: readonly ThinkingLevel[]) => void
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

export function ModelPickerButton(props: { draft: string }) {
  const members = () => room.roomMembers()
  const painted = afterFirstPaint()
  const target = () => members().find((m) => m.slug === pickerFor()) ?? answeringMember(members(), props.draft)
  return (
    <Show when={hasModelProvider(connectedProviders()) ? target() : undefined}>
      {(member) => {
        const current = () => user.agentModel(member().slug)
        const label = () => current()?.name ?? current()?.model.split("/").slice(1).join("/") ?? "Choose model"
        return (
          <>
            <ModelPicker
              current={current()?.model}
              open={pickerOpen()}
              onOpenChange={changePicker}
              onPick={(ref, levels) => ref !== current()?.model && room.setAgentModel(member().slug, { ref, levels })}
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
            <ReasoningMenu
              levels={current()?.thinkingLevels}
              value={current()?.thinking}
              model={current()?.name}
              onChange={(thinking) => room.setAgentModel(member().slug, { thinking })}
            />
          </>
        )
      }}
    </Show>
  )
}
