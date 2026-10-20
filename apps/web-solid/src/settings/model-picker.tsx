import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { createSignal, lazy, Show, Suspense, type JSX } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import type { ThinkingLevel } from "@kiko/protocol"
import { answeringMember } from "./agent-model"
import { ReasoningMenu } from "./reasoning-menu"
import { connectedProviders } from "./connected"
import { hasModelProvider } from "./provider-kinds"

export { favoriteModels, hiddenModels, toggleFavorite } from "./model-prefs"

const loadPanel = () => import("./model-picker-panel")
const ModelPickerPanel = lazy(loadPanel)
export const preloadModelPicker = () => void loadPanel()

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

export function ModelPicker(props: { current?: string; onPick: (ref: string, thinking: readonly ThinkingLevel[]) => void; open: boolean; onOpenChange: (open: boolean) => void; children: JSX.Element; class?: string; title?: string }) {
  let trigger: HTMLButtonElement | undefined
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={props.class}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        title={props.title}
        data-component="model-picker-button"
        onPointerEnter={loadPanel}
        onFocus={loadPanel}
        onClick={() => props.onOpenChange(!props.open)}
      >
        {props.children}
      </button>
      <Show when={props.open}>
        <Suspense>
          <ModelPickerPanel current={props.current} onPick={props.onPick} onOpenChange={props.onOpenChange} trigger={() => trigger} />
        </Suspense>
      </Show>
    </>
  )
}

export function ModelPickerButton(props: { draft: string }) {
  const members = () => useApp.roomMembers()
  const target = () => members().find((m) => m.slug === pickerFor()) ?? answeringMember(members(), props.draft)
  return (
    <Show when={hasModelProvider(connectedProviders()) ? target() : undefined}>
      {(member) => {
        const current = () => useApp.agentModel(member().slug)
        return (
          <>
            <ModelPicker
              current={current()?.model}
              open={pickerOpen()}
              onOpenChange={changePicker}
              onPick={(ref, levels) => ref !== current()?.model && useApp.setAgentModel(member().slug, { ref, levels })}
              title={members().length > 1 ? `Choose model for ${member().name}` : "Choose model"}
              class="flex h-7 max-w-[240px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
            >
              <Show when={members().length > 1}>
                <IdentityAvatar seed={member().slug} size={14} />
              </Show>
              <Show when={current()?.model.split("/")[0]}>{(provider) => <ProviderIcon id={provider()} width="13" height="13" />}</Show>
              <span class="truncate" data-component="composer-model">{current()?.name ?? current()?.model.split("/").slice(1).join("/") ?? "Choose model"}</span>
              <svg class="size-2.5 shrink-0 opacity-70" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 4.5L6 7.5l3-3" />
              </svg>
            </ModelPicker>
            <ReasoningMenu levels={current()?.thinkingLevels} value={current()?.thinking} onChange={(thinking) => useApp.setAgentModel(member().slug, { thinking })} />
          </>
        )
      }}
    </Show>
  )
}

