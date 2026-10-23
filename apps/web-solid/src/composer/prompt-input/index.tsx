import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  getOwner,
  lazy,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  Suspense,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowUpIcon, AtIcon, AttachIcon, CloseIcon, EnterIcon } from "@kiko/ui/icons"
import { useI18n } from "@kiko/ui/context/i18n"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import type { PromptInputV2Interaction } from "./interaction"
import { createComposerEmoji, createShortcodes } from "../emoji"
import type { RichBinding } from "../rich/bind"
import { setRichLoaded } from "../rich/loaded"
import { mountLite, type LiteField } from "../rich/lite"
import { isImage } from "../../lib/attachments"
import { EntryIcon } from "../../lib/EntryIcon"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { progressLabel, uploadState } from "../../sync/uploads"

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
  const emoji = createComposerEmoji(
    () => field()?.dom as HTMLDivElement | undefined,
    () => !!props.disabled || !!props.readOnly,
  )
  const popoverID = createUniqueId()
  const statusID = createUniqueId()
  const [editable, setEditable] = createSignal<HTMLElement>()
  let richHost!: HTMLDivElement
  const syncBlank = () => setBlank(field()?.isEmpty() ?? true)
  const dropArea = createMemo(() => {
    if (state.drag !== "active") return null
    const column = richHost?.closest('[data-component="chat-shell"]') ?? richHost?.closest("form")
    const box = column?.getBoundingClientRect()
    if (!box) return null
    return {
      top: `${box.top + 8}px`,
      left: `${box.left + 8}px`,
      width: `${box.width - 16}px`,
      height: `${box.height - 16}px`,
    }
  })

  onMount(() => {
    const owner = getOwner()
    const label = i18n.t("ui.promptInput.label")
    lite = mountLite({
      host: richHost,
      controller: props.controller,
      label,
      disabled: () => !!props.disabled || !!props.readOnly,
      onEdit: syncBlank,
    })
    setEditable(lite.dom)
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
        setEditable(binding.editor.dom)
        if (focused) binding.editor.focus()
        syncBlank()
      })
    })
  })

  const syncViewport = () => {
    const viewport = window.visualViewport
    if (!viewport) return
    const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    const root = document.documentElement.style
    root.setProperty("--composer-keyboard-inset", `${covered}px`)
    root.setProperty("--composer-viewport-height", `${Math.round(viewport.height)}px`)
  }

  onMount(() => {
    const viewport = window.visualViewport
    syncViewport()
    viewport?.addEventListener("resize", syncViewport)
    viewport?.addEventListener("scroll", syncViewport)
    onCleanup(() => {
      viewport?.removeEventListener("resize", syncViewport)
      viewport?.removeEventListener("scroll", syncViewport)
      document.documentElement.style.removeProperty("--composer-keyboard-inset")
      document.documentElement.style.removeProperty("--composer-viewport-height")
    })
  })

  createEffect(() => {
    const dom = editable()
    if (!dom) return
    const popover = state.popover
    const open = popover.type !== "closed"
    const activeID = popover.type === "closed" ? undefined : popover.activeID
    const active = activeID ? props.controller.suggestions().findIndex((item) => item.id === activeID) : -1
    dom.setAttribute("aria-expanded", open ? "true" : "false")
    if (open) dom.setAttribute("aria-controls", popoverID)
    else dom.removeAttribute("aria-controls")
    if (active >= 0) dom.setAttribute("aria-activedescendant", `${popoverID}-opt-${active}`)
    else dom.removeAttribute("aria-activedescendant")
  })

  const uploadStatus = createMemo(() => {
    const uploading = props.controller
      .attachments()
      .map((part) => uploadState(part.id))
      .flatMap((upload) => (upload?.status === "uploading" ? [progressLabel(upload.progress)] : []))
    return uploading.length ? `Uploading ${uploading.join(", ")}` : ""
  })

  const submitStatus = createMemo(() =>
    [view.submit.preparing?.() ? i18n.t("ui.promptInput.preparing") : "", view.submit.blocked?.() ?? "", uploadStatus()]
      .filter(Boolean)
      .join(". "),
  )

  const pictures = () =>
    props.controller.attachments().filter((part) => isImage({ name: part.filename, type: part.mime }))
  const documents = () =>
    props.controller.attachments().filter((part) => !isImage({ name: part.filename, type: part.mime }))
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
            id={popoverID}
            label={i18n.t(state.popover.type === "command-menu" ? "ui.promptInput.commands" : "ui.promptInput.context")}
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
              <div
                role="status"
                class="flex items-center gap-2 rounded-full border border-ring/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
              >
                <RemixIcon icon={AttachIcon} class="size-4 text-ring" />
                {i18n.t(
                  props.controller.dragKind() === "reference"
                    ? "ui.promptInput.dropReference"
                    : "ui.promptInput.dropFiles",
                )}
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
          <Show when={documents().length > 0}>
            <ul class="flex flex-wrap items-center gap-1.5" data-component="prompt-input-v2-files">
              <For each={documents()}>
                {(attachment) => (
                  <li
                    class="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-accent py-0.5 pr-0.5 pl-2 text-xs"
                    data-component="composer-file"
                    data-id={attachment.id}
                  >
                    <EntryIcon path={attachment.filename} />
                    <span class="min-w-0 truncate" title={attachment.filename}>
                      {attachment.filename}
                    </span>
                    <button
                      type="button"
                      class="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-control hover:text-foreground"
                      aria-label={`Remove ${attachment.filename}`}
                      onClick={() => props.controller.removeAttachment(attachment.id)}
                    >
                      <RemixIcon icon={CloseIcon} size={12} />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div
            class="composer-main"
            data-component="prompt-input-box"
            onPointerDown={(e) => e.target === e.currentTarget && field()?.focus()}
          >
            <div class="composer-field">
              <div ref={richHost} class="composer-rich" classList={{ "opacity-50": props.disabled }} />
              <Show when={blank()}>
                <div class="composer-placeholder">{view.placeholder?.() ?? i18n.t("ui.promptInput.label")}</div>
              </Show>
            </div>
          </div>
          <div class="composer-footer">
            <div class="composer-tray">
              <Show when={!props.answering && !props.readOnly && props.controller.agents().length > 0}>
                <MenuV2 gutter={6} placement="top-start">
                  <MenuV2.Trigger
                    class="composer-icon"
                    aria-label="Mention an agent"
                    title="Mention an agent"
                    data-action="composer-mention"
                  >
                    <RemixIcon icon={AtIcon} class="size-4" />
                  </MenuV2.Trigger>
                  <MenuV2.Portal>
                    <MenuV2.Content class="z-[80] min-w-44" data-component="mention-menu">
                      <For each={props.controller.agents()}>
                        {(item) => (
                          <MenuV2.Item
                            onSelect={() => props.controller.mention(item)}
                            data-agent={item.mention?.type === "agent" ? item.mention.name : undefined}
                          >
                            <IdentityAvatar
                              seed={item.mention?.type === "agent" ? item.mention.name : item.id}
                              size={18}
                            />
                            <span class="truncate">{item.title ?? item.label}</span>
                          </MenuV2.Item>
                        )}
                      </For>
                    </MenuV2.Content>
                  </MenuV2.Portal>
                </MenuV2>
              </Show>
              {props.tray}
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
                    <RemixIcon icon={AttachIcon} class="size-4" />
                  </button>
                </TooltipV2>
                <PromptInputV2SubmitButton
                  mode={state.mode}
                  disabled={!props.controller.canSubmit()}
                  blocked={view.submit.blocked?.() ?? null}
                  sendLabel={i18n.t("ui.promptInput.send")}
                  describedBy={statusID}
                  onSubmit={props.controller.submit}
                />
              </Show>
            </div>
          </div>
          <div id={statusID} role="status" class="sr-only">
            {submitStatus()}
          </div>
        </div>
      </form>
    </div>
  )
}

function PromptInputV2SubmitButton(props: {
  mode: PromptInputV2Mode
  disabled: boolean
  blocked?: string | null
  sendLabel: string
  describedBy?: string
  onSubmit: () => void
}) {
  return (
    <TooltipV2 placement="top" inactive={props.disabled && !props.blocked} value={props.blocked ?? props.sendLabel}>
      <button
        data-action="prompt-submit"
        type="button"
        disabled={props.disabled}
        tabIndex={props.mode === "normal" ? undefined : -1}
        class="composer-send"
        aria-label={props.sendLabel}
        aria-describedby={props.blocked ? props.describedBy : undefined}
        title={props.blocked ?? undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onSubmit()
        }}
      >
        {props.mode === "shell" ? (
          <RemixIcon icon={EnterIcon} class="size-4" />
        ) : (
          <RemixIcon icon={ArrowUpIcon} class="size-4" />
        )}
      </button>
    </TooltipV2>
  )
}
