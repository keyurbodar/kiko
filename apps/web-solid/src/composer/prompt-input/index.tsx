import { createMemo, createSignal, getOwner, lazy, onMount, runWithOwner, Show, Suspense, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ArrowUpIcon, CornerDownLeftIcon, PaperclipIcon, SquareIcon } from "lucide-solid"
import { useI18n } from "@kiko/ui/context/i18n"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import type { PromptInputV2Interaction } from "./interaction"
import { createComposerEmoji, createShortcodes } from "../emoji"
import type { RichBinding } from "../rich/bind"
import { setRichLoaded } from "../rich/loaded"
import { mountLite, type LiteField } from "../rich/lite"
import { isImage } from "../../lib/attachments"

export type {
  PromptInputV2Attachment,
  PromptInputV2Option,
  PromptInputV2PersistedState,
  PromptInputV2Suggestion,
} from "./types"

export type PromptInputV2Mode = "normal" | "shell"

const extras = () => import("./extras")
const PromptInputV2Attachments = lazy(() => extras().then((m) => ({ default: m.PromptInputV2Attachments })))
const PromptInputV2Popover = lazy(() => extras().then((m) => ({ default: m.PromptInputV2Popover })))

export type PromptInputV2Props = {
  controller: PromptInputV2Interaction
  disabled?: boolean
  readOnly?: boolean
  class?: string
  reply?: JSX.Element
  tray?: JSX.Element
  answering?: boolean
  isMention?: (slug: string) => boolean
}

export function PromptInputV2(props: PromptInputV2Props) {
  const i18n = useI18n()
  const state = props.controller.state
  const view = props.controller.view
  const [blank, setBlank] = createSignal(true)
  let binding: RichBinding | undefined
  let lite: LiteField | undefined
  const field = () => binding?.editor ?? lite
  const shortcodes = createShortcodes(() => field()?.dom as HTMLDivElement | undefined)
  const emoji = createComposerEmoji(() => field()?.dom as HTMLDivElement | undefined, () => !!props.disabled || !!props.readOnly)
  let richHost!: HTMLDivElement
  const syncBlank = () => setBlank(field()?.isEmpty() ?? true)
  const dropArea = createMemo(() => {
    if (state.drag !== "active") return null
    const column = richHost?.closest('[data-component="chat-shell"]') ?? richHost?.closest("form")
    const box = column?.getBoundingClientRect()
    if (!box) return null
    return { top: `${box.top + 8}px`, left: `${box.left + 8}px`, width: `${box.width - 16}px`, height: `${box.height - 16}px` }
  })

  onMount(() => {
    const owner = getOwner()
    const label = i18n.t("ui.promptInput.label")
    lite = mountLite({ host: richHost, controller: props.controller, label, disabled: () => !!props.disabled || !!props.readOnly, onEdit: syncBlank })
    syncBlank()
    void import("../rich/bind").then(({ bindRich }) => {
      setRichLoaded(true)
      return runWithOwner(owner, () => {
        const focused = lite?.isFocused()
        lite?.destroy()
        lite = undefined
        binding = bindRich({
          host: richHost,
          controller: props.controller,
          label,
          isMention: (slug) => props.isMention?.(slug) ?? false,
          disabled: () => !!props.disabled || !!props.readOnly,
          shortcodes,
          onEdit: syncBlank,
          onFocus: () => {},
        })
        if (focused) binding.editor.focus()
        syncBlank()
      })
    })
  })

  // The shelf holds pictures. Files are chips in the text.
  const pictures = () => props.controller.attachments().filter((part) => isImage({ name: part.filename, type: part.mime }))
  return (
    <div class={`relative flex flex-col ${props.class ?? ""}`}>
      <input
        ref={props.controller.setFileInput}
        type="file"
        multiple
        aria-label="Attach files"
        class="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          if (files.length > 0) props.controller.addAttachments(files)
        }}
      />
      {shortcodes.view}
      {emoji.view}
      <Show when={state.popover.type !== "closed"}>
        <Suspense>
          <PromptInputV2Popover
            emptyLabel={i18n.t("ui.promptInput.noMatchingItems")}
            items={props.controller.suggestions()}
            activeID={state.popover.type === "closed" ? undefined : state.popover.activeID}
            search={
              state.popover.type === "command-menu"
                ? {
                    value: state.popover.query,
                    label: i18n.t("ui.promptInput.commands"),
                    placeholder: "/",
                    onValueChange: props.controller.setQuery,
                    onKeyDown: props.controller.onKeyDown,
                  }
                : undefined
            }
            onActiveChange={(item) => props.controller.dispatch({ type: "popover.active", id: item.id })}
            onSelect={(item) => props.controller.dispatch({ type: "popover.select", item })}
          />
        </Suspense>
      </Show>
      <Show when={dropArea()}>
        {(area) => (
          <Portal>
            <div
              class="pointer-events-none fixed z-40 flex items-center justify-center rounded-2xl border border-dashed border-ring/60 bg-ring/[0.035]"
              style={area()}
              data-component="composer-drop-overlay"
            >
              <div role="status" class="flex items-center gap-2 rounded-full border border-ring/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg">
                <PaperclipIcon class="size-4 text-ring" />
                {i18n.t(props.controller.dragKind() === "reference" ? "ui.promptInput.dropReference" : "ui.promptInput.dropFiles")}
              </div>
            </div>
          </Portal>
        )}
      </Show>
      <form
        data-component="prompt-input-v2"
        class="composer-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.disabled) props.controller.submit()
        }}
      >
        <div class="composer-box">
          {props.reply}
          <Show when={pictures().length > 0}>
            <Suspense>
              <PromptInputV2Attachments
                attachments={pictures()}
                onImageClick={props.controller.openAttachment}
                onRemove={(attachment) => props.controller.removeAttachment(attachment.id)}
              />
            </Suspense>
          </Show>
          <div class="composer-main" data-component="prompt-input-box" onPointerDown={(e) => e.target === e.currentTarget && field()?.focus()}>
            <div class="composer-field">
              <div ref={richHost} class="composer-rich" classList={{ "opacity-50": props.disabled }} />
              <Show when={blank()}>
                <div class="composer-placeholder">{view.placeholder?.() ?? i18n.t("ui.promptInput.label")}</div>
              </Show>
            </div>
            <div class="composer-actions">
              <Show when={!props.readOnly}>{emoji.trigger}</Show>
              <Show when={!props.answering}>
              <TooltipV2 placement="top" openDelay={400} value={i18n.t("ui.promptInput.add")}>
                <button
                  type="button"
                  class="composer-icon"
                  data-hint="chat.attach"
                  aria-label={i18n.t("ui.promptInput.add")}
                  onClick={() => props.controller.attach()}
                >
                  <PaperclipIcon class="size-4" />
                </button>
              </TooltipV2>
              </Show>
              <Show when={!props.answering}>
              <PromptInputV2SubmitButton
                mode={state.mode}
                stopping={view.submit.stopping()}
                disabled={!props.controller.canSubmit()}
                blocked={view.submit.blocked?.() ?? null}
                sendLabel={i18n.t(view.submit.preparing?.() ? "ui.promptInput.preparing" : "ui.promptInput.send")}
                stopLabel={i18n.t("ui.promptInput.stop")}
                onSubmit={props.controller.submit}
                onStop={props.controller.stop}
              />
              </Show>
            </div>
          </div>
          <div class="composer-tray">{props.tray}</div>
        </div>
      </form>
    </div>
  )
}

export function PromptInputV2SubmitButton(props: {
  mode: PromptInputV2Mode
  stopping: boolean
  disabled: boolean
  blocked?: string | null
  sendLabel: string
  stopLabel: string
  onSubmit: () => void
  onStop: () => void
}) {
  const label = () => (props.stopping ? props.stopLabel : (props.blocked ?? props.sendLabel))
  return (
    <TooltipV2
      placement="top"
      inactive={!props.stopping && props.disabled && !props.blocked}
      value={label()}
    >
      <button
        data-action="prompt-submit"
        type="button"
        disabled={!props.stopping && props.disabled}
        tabIndex={props.mode === "normal" ? undefined : -1}
        class="composer-send"
        aria-label={label()}
        title={props.blocked ?? undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (props.stopping) {
            props.onStop()
            return
          }
          props.onSubmit()
        }}
      >
        {props.stopping ? (
          <SquareIcon class="size-3 fill-current" aria-hidden="true" />
        ) : props.mode === "shell" ? (
          <CornerDownLeftIcon class="size-4" aria-hidden="true" />
        ) : (
          <ArrowUpIcon class="size-4" aria-hidden="true" />
        )}
      </button>
    </TooltipV2>
  )
}
