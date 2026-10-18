import { ProviderIcon } from "@kiko/ui/provider-icon"
import "@kiko/ui/provider-icon.css"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon } from "@kiko/ui/icons"
import { createSignal, lazy, Show, type JSX } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import type { ThinkingLevel } from "@kiko/protocol"
import { answeringMember } from "./agent-model"
import { ReasoningMenu } from "./reasoning-menu"
import { connectedProviders } from "./connected"
import { hasModelProvider } from "./provider-kinds"

/** The panel reads the saved model choices through this module, so they stay in the chunk the chat route already loads. */
export { favoriteModels, hiddenModels, toggleFavorite } from "./model-prefs"

const loadPanel = () => import("./model-picker-panel")
/** The panel loads on first open, or on the first hover or focus of the button. */
const ModelPickerPanel = lazy(loadPanel)
export const preloadModelPicker = () => void loadPanel()

const [pickerOpen, setPickerOpen] = createSignal(false)
/** The agent a failed run or a blocked send wants the picker for. Null means the one the draft addresses. */
const [pickerFor, setPickerFor] = createSignal<string | null>(null)
/** Opens the composer's model picker, from the palette or Mod+Shift+M, or for one agent from an error line. */
export const openModelPicker = (slug?: string) => {
  setPickerFor(slug ?? null)
  setPickerOpen(true)
}
const changePicker = (open: boolean) => {
  if (!open) setPickerFor(null)
  setPickerOpen(open)
}

/**
 * The model picker: a rail of providers with favorites first, a search across all of them, and
 * one virtual list, so a hundred providers with a thousand models each still open at once.
 */
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
        <ModelPickerPanel current={props.current} onPick={props.onPick} onOpenChange={props.onOpenChange} trigger={() => trigger} />
      </Show>
    </>
  )
}

/**
 * The composer's model and reasoning controls, for the agent that will answer: the lead, or the
 * agent the draft tags. In a group the avatar says whose model it is.
 */
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
              <RemixIcon icon={ChevronDownIcon} class="size-2.5 shrink-0 opacity-70" />
            </ModelPicker>
            <ReasoningMenu levels={current()?.thinkingLevels} value={current()?.thinking} onChange={(thinking) => useApp.setAgentModel(member().slug, { thinking })} />
          </>
        )
      }}
    </Show>
  )
}

