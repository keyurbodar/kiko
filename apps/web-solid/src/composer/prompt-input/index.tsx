import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  getOwner,
  lazy,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  Suspense,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ArrowUpIcon, AttachIcon, ChevronDownIcon, PlusIcon } from "@kiko/ui/icons"
import { useI18n } from "@kiko/ui/context/i18n"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import type { PromptInputV2Interaction } from "./interaction"
import { createShortcodes } from "../emoji"
import type { RichBinding } from "../rich/bind"
import type { ParseOptions } from "../rich/markdown"
import { setRichLoaded } from "../rich/loaded"
import { mountLite, type LiteField } from "../rich/lite"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { afterFirstPaint } from "../../lib/motion"
import { progressLabel, uploadState } from "../uploads"
import type { Token } from "../tokens"
import type { ChipSource } from "./chip"
import { type Rejected, Tray } from "./tray"
import "./prompt-input.css"
import type { PromptInputV2Attachment } from "./types"

export type { PromptInputV2Attachment, PromptInputV2PersistedState } from "./types"

const TokenPopover = lazy(() => import("./popover"))

const HINT_EVERY_MS = 6000
const POPOVER_WIDTH = 320

type RecipientPeople = {
  group: boolean
  adding: boolean
  onAddingChange: (open: boolean) => void
  addItems: () => JSX.Element
}

export type PromptInputV2Props = {
  controller: PromptInputV2Interaction
  disabled?: boolean
  readOnly?: boolean
  reply?: JSX.Element
  below?: JSX.Element
  tray?: JSX.Element
  answering?: boolean
  editing?: boolean
  parse: ParseOptions
  chips: Omit<ChipSource, "attachments" | "openAttachment">
  recipient?: Token
  people?: RecipientPeople
  hints: () => readonly string[]
  stop?: () => void
  waiting?: boolean
  rejected: Rejected[]
  onDismissRejected: (id: string) => void
  onExpandPasted: (part: PromptInputV2Attachment) => void
}

function createGrow(editable: () => HTMLElement | undefined, host: () => HTMLElement) {
  createEffect(() => {
    const dom = editable()
    if (!dom) return
    const wrap = host()
    const sync = () => {
      wrap.style.height = `${dom.offsetHeight}px`
      wrap.toggleAttribute("data-scrolled", dom.scrollTop > 2)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(dom)
    dom.addEventListener("scroll", sync, { passive: true })
    onCleanup(() => {
      observer.disconnect()
      dom.removeEventListener("scroll", sync)
    })
  })
}

function createHint(hints: () => readonly string[], quiet: () => boolean) {
  const [index, setIndex] = createSignal(0)
  createEffect(() => {
    const count = hints().length
    if (count < 2 || quiet() || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = setInterval(() => setIndex((at) => (at + 1) % count), HINT_EVERY_MS)
    onCleanup(() => clearInterval(timer))
  })
  return () => hints()[index() % Math.max(1, hints().length)] ?? ""
}

function caretLeft(form: HTMLElement | undefined): number {
  const selection = window.getSelection()
  if (!form || !selection?.rangeCount) return 0
  const range = selection.getRangeAt(0)
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const box = form.getBoundingClientRect()
  if (!rect || !rect.left) return 0
  return Math.max(0, Math.min(rect.left - box.left - 24, box.width - POPOVER_WIDTH))
}

export function PromptInputV2(props: PromptInputV2Props) {
  const i18n = useI18n()
  const state = props.controller.state
  const view = props.controller.view
  const [blank, setBlank] = createSignal(true)
  const painted = afterFirstPaint()
  const [focused, setFocused] = createSignal(false)
  let binding: RichBinding | undefined
  let lite: LiteField | undefined
  const field = () => binding?.editor ?? lite
  const shortcodes = createShortcodes(() => field()?.dom as HTMLDivElement | undefined)
  const popoverID = createUniqueId()
  const statusID = createUniqueId()
  const [editable, setEditable] = createSignal<HTMLElement>()
  let richHost!: HTMLDivElement
  let form: HTMLFormElement | undefined
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
        const wasFocused = lite?.isFocused()
        lite?.destroy()
        lite = undefined
        binding = bindRich({
          host: richHost,
          controller: props.controller,
          label,
          parse: props.parse,
          chips: props.chips,
          disabled: () => !!props.disabled || !!props.readOnly,
          shortcodes,
          onEdit: syncBlank,
          onFocus: () => {},
        })
        setEditable(binding.editor.dom)
        if (wasFocused) binding.editor.focus()
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

  createGrow(editable, () => richHost)
  const hint = createHint(props.hints, () => !blank() || focused())

  const open = () => state.popover.type === "open" && props.controller.groups().length > 0
  const [left, setLeft] = createSignal(0)
  createEffect(
    on(
      () => (state.popover.type === "open" ? state.popover.start : -1),
      (start) => {
        if (start >= 0) setLeft(caretLeft(form))
      },
    ),
  )

  createEffect(() => {
    const dom = editable()
    if (!dom) return
    const activeID = state.popover.type === "open" ? state.popover.activeID : undefined
    const active = activeID ? props.controller.suggestions().findIndex((item) => item.id === activeID) : -1
    dom.setAttribute("aria-expanded", open() ? "true" : "false")
    if (open()) dom.setAttribute("aria-controls", popoverID)
    else dom.removeAttribute("aria-controls")
    if (open() && active >= 0) dom.setAttribute("aria-activedescendant", `${popoverID}-opt-${active}`)
    else dom.removeAttribute("aria-activedescendant")
  })

  const uploadStatus = createMemo(() => {
    const uploading = props.controller
      .attachments()
      .map((part) => uploadState(part.id))
      .flatMap((upload) => (upload?.status === "uploading" ? [progressLabel(upload.loaded, upload.total)] : []))
    return uploading.length ? `Uploading ${uploading.join(", ")}` : ""
  })

  const submitStatus = createMemo(() =>
    [view.submit.preparing?.() ? i18n.t("ui.promptInput.preparing") : "", view.submit.blocked?.() ?? "", uploadStatus()]
      .filter(Boolean)
      .join(". "),
  )

  const stopping = () => !!props.stop && blank() && props.controller.attachments().length === 0 && !props.answering
  const showTray = () => props.controller.trayAttachments().length > 0 || props.rejected.length > 0
  return (
    <div class="relative flex flex-col">
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
      <Show when={open()}>
        <Suspense>
          <TokenPopover
            id={popoverID}
            label={state.popover.type === "open" && state.popover.trigger === "/" ? "Skills and commands" : "Mention"}
            groups={props.controller.groups()}
            activeID={state.popover.type === "open" ? state.popover.activeID : undefined}
            left={left()}
            onActiveChange={(item) => props.controller.dispatch({ type: "popover.active", id: item.id })}
            onSelect={(item) => props.controller.dispatch({ type: "popover.select", item })}
          />
        </Suspense>
      </Show>
      <Show when={dropArea()}>
        {(area) => (
          <Portal>
            <div class="composer-drop" style={area()} data-component="composer-drop-overlay">
              <div role="status" class="composer-drop-label">
                <RemixIcon icon={AttachIcon} size={16} />
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
        ref={form}
        data-component="prompt-input-v2"
        class="composer-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!props.disabled) props.controller.submit()
        }}
      >
        <div
          class="composer-box"
          data-editing={props.editing ? "" : undefined}
          onFocusIn={() => setFocused(true)}
          onFocusOut={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
          }}
        >
          {props.reply}
          <Show when={showTray()}>
            <Tray
              attachments={props.controller.trayAttachments()}
              rejected={props.rejected}
              onOpen={props.controller.openAttachment}
              onRemove={(part) => props.controller.removeAttachment(part.id)}
              onExpand={props.onExpandPasted}
              onMove={props.controller.moveAttachment}
              onDismiss={props.onDismissRejected}
            />
          </Show>
          <div
            class="composer-main"
            data-component="prompt-input-box"
            onPointerDown={(e) => e.target === e.currentTarget && field()?.focus()}
          >
            <div class="composer-field">
              <div ref={richHost} class="composer-rich" classList={{ "opacity-50": props.disabled }} />
              <Show when={blank()}>
                <Show when={hint()} keyed>
                  {(text) => (
                    <div class="composer-placeholder" data-enter={painted() ? "" : undefined}>
                      {text}
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          </div>
          <div class="composer-footer">
            <div class="composer-tray">
              <Show when={!props.answering}>
                <TooltipV2 placement="top" openDelay={400} value={i18n.t("ui.promptInput.add")}>
                  <button
                    type="button"
                    class="composer-icon"
                    data-hint="chat.attach"
                    aria-label={i18n.t("ui.promptInput.add")}
                    onClick={() => props.controller.attach()}
                  >
                    <RemixIcon icon={PlusIcon} size={18} />
                  </button>
                </TooltipV2>
              </Show>
              <Show when={!props.answering && !props.readOnly && props.recipient}>
                {(recipient) => (
                  <Recipient recipient={recipient()} controller={props.controller} people={props.people} />
                )}
              </Show>
              {props.tray}
            </div>
            <div class="composer-actions">
              <Show when={!props.answering}>
                <SubmitButton
                  stop={stopping()}
                  waiting={!!props.waiting}
                  disabled={!stopping() && !props.controller.canSubmit()}
                  blocked={view.submit.blocked?.() ?? null}
                  sendLabel={i18n.t("ui.promptInput.send")}
                  describedBy={statusID}
                  onSubmit={() => (stopping() ? props.stop?.() : props.controller.submit())}
                />
              </Show>
            </div>
          </div>
          <div id={statusID} role="status" class="sr-only">
            {submitStatus()}
          </div>
        </div>
        {props.below}
      </form>
    </div>
  )
}

function RecipientFace(props: { recipient: Token }) {
  const seed = () => (props.recipient.kind === "agent" ? props.recipient.slug : props.recipient.id)
  const painted = afterFirstPaint()
  return (
    <>
      <span class="composer-agent-face">
        <Show when={seed()} keyed>
          {(face) => <IdentityAvatar seed={face} size={20} class={painted() ? "composer-agent-avatar" : ""} />}
        </Show>
      </span>
      <span class="composer-agent-name">{props.recipient.title}</span>
    </>
  )
}

function AddSomeoneMenu(props: { people: RecipientPeople }) {
  return (
    <MenuV2 gutter={6} placement="top-start" open={props.people.adding} onOpenChange={props.people.onAddingChange}>
      <MenuV2.Trigger class="composer-agent-anchor" tabIndex={-1} aria-label="Add someone to this chat">
        <span />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-48" data-component="add-member-menu">
          {props.people.addItems()}
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function Recipient(props: { recipient: Token; controller: PromptInputV2Interaction; people?: RecipientPeople }) {
  return (
    <span class="composer-agent-wrap">
      <Show when={props.people?.group !== false}>
        <MenuV2 gutter={6} placement="top-start">
          <MenuV2.Trigger
            class="composer-agent"
            aria-label="Mention an agent"
            title="Mention an agent"
            data-action="composer-mention"
          >
            <RecipientFace recipient={props.recipient} />
            <RemixIcon icon={ChevronDownIcon} size={11} class="composer-agent-chevron" />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-44" data-component="mention-menu">
              <For each={props.controller.agents()}>
                {(item) => (
                  <MenuV2.Item
                    onSelect={() => props.controller.mention(item)}
                    data-agent={item.kind === "agent" ? item.slug : undefined}
                  >
                    <IdentityAvatar seed={item.kind === "agent" ? item.slug : item.id} size={18} />
                    <span class="truncate">{item.title}</span>
                  </MenuV2.Item>
                )}
              </For>
              <Show when={props.people}>
                {(people) => (
                  <>
                    <MenuV2.Separator />
                    <MenuV2.Item
                      data-action="add-someone"
                      onSelect={() => requestAnimationFrame(() => people().onAddingChange(true))}
                    >
                      <RemixIcon icon={PlusIcon} size={16} class="text-fg2" />
                      <span class="truncate">Add someone…</span>
                    </MenuV2.Item>
                  </>
                )}
              </Show>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </Show>
      <Show when={props.people}>{(people) => <AddSomeoneMenu people={people()} />}</Show>
    </span>
  )
}

function SubmitButton(props: {
  stop: boolean
  waiting: boolean
  disabled: boolean
  blocked?: string | null
  sendLabel: string
  describedBy?: string
  onSubmit: () => void
}) {
  const [sent, setSent] = createSignal(false)
  const label = () => (props.stop ? "Stop" : props.sendLabel)
  return (
    <TooltipV2
      placement="top"
      inactive={props.disabled && !props.blocked}
      value={props.stop ? "Stop (Esc)" : (props.blocked ?? props.sendLabel)}
    >
      <button
        data-action={props.stop ? "prompt-stop" : "prompt-submit"}
        data-mode={props.stop ? "stop" : "send"}
        data-sent={sent() ? "" : undefined}
        data-waiting={props.waiting ? "" : undefined}
        type="button"
        disabled={props.disabled}
        class="composer-send"
        aria-label={label()}
        aria-describedby={props.blocked ? props.describedBy : undefined}
        title={props.blocked ?? undefined}
        onAnimationEnd={(event) => {
          if (event.animationName === "composer-send-ripple") setSent(false)
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!props.stop) setSent(true)
          props.onSubmit()
        }}
      >
        <RemixIcon icon={ArrowUpIcon} class="composer-send-arrow size-4" />
        <span class="composer-send-square" aria-hidden="true" />
        <Show when={props.waiting}>
          <svg class="composer-send-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16.5" />
          </svg>
        </Show>
      </button>
    </TooltipV2>
  )
}
