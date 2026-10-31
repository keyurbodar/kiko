import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon, DownloadIcon, SearchIcon } from "@kiko/ui/icons"
import { Command as Cmdk } from "cmdk-solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { commands, type RowAction } from "../commands/registry"
import { messageStatus, typeMessageQuery } from "../commands/message-search"
import { formatBytes } from "../chat/info/format"
import {
  iconFor,
  backspaceLeaves,
  createPreview,
  emptyText,
  enterLabel,
  filterGroups,
  searchGroups,
  viewFor,
} from "./model"
import { attachable, attachFiles, canAttach, downloadFiles } from "./file-actions"
import { askKiko } from "./ask"
import { intentOf, type Intent } from "./keys"
import { Actions, Peek } from "./side"
import { AskKiko, Empty, Hint, Key, Row, Skeleton } from "./parts"
import type { FileEntry } from "./sources"
import {
  backView,
  chooseTab,
  closePalette,
  enterView,
  filesFolder,
  openFolder,
  paletteStack,
  paletteTab,
  pickedFiles,
  setPicks,
  stepTab,
  TABS,
} from "./state"
import { filesCrumbs, tabGroups, type TabData } from "./tabs"
import "./palette.css"

const EXIT_MS = 80

const EMPTY_TEXT: Record<string, string> = {
  chats: "No chats yet",
  agents: "No agents yet",
  files: "No files yet",
  recipes: "No recipes yet",
  settings: "No settings found",
  all: "Nothing here yet",
}

function revealTab(strip: HTMLElement, el: HTMLElement) {
  const fade = 24
  const left = el.offsetLeft - fade
  const right = el.offsetLeft + el.offsetWidth + fade - strip.clientWidth
  if (strip.scrollLeft > left) strip.scrollLeft = Math.max(0, left)
  else if (strip.scrollLeft < right) strip.scrollLeft = right
}

export function PaletteSurface(props: { source: TabData }) {
  const [query, setQuery] = createSignal("")
  const [kept, setKept] = createSignal<readonly string[] | null>(null)
  const open = () => paletteStack() !== null
  const stack = () => paletteStack() ?? kept() ?? []
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const now = paletteStack()
    clearTimeout(timer)
    if (now) return setKept(now)
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (still) setKept(null)
    else timer = setTimeout(() => setKept(null), EXIT_MS)
  })
  onCleanup(() => clearTimeout(timer))

  const narrowQuery = matchMedia("(width < 480px)")
  const [narrow, setNarrow] = createSignal(narrowQuery.matches)
  const onNarrow = () => setNarrow(narrowQuery.matches)
  narrowQuery.addEventListener("change", onNarrow)
  onCleanup(() => narrowQuery.removeEventListener("change", onNarrow))

  const root = () => stack().length === 0
  const tab = paletteTab
  const text = createMemo(() => query().trim())
  const view = createMemo(() => viewFor(stack(), commands()))
  const searching = () => view().parent?.search
  const filesTab = () => root() && tab() === "files"

  const groups = createMemo(() => {
    const parent = view().parent
    if (parent?.search) return searchGroups(parent, query())
    if (root()) return tabGroups(tab(), text(), props.source)
    return filterGroups(view().groups, text())
  })
  const items = () => groups().flatMap((g) => g.items)

  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  let tabsEl: HTMLDivElement | undefined
  const [highlight, setHighlight] = createSignal("")
  const current = () => items().find((i) => i.key === highlight())

  let before: Element | null = null
  createEffect(() => {
    if (open()) {
      before ??= document.activeElement
      setHighlight("")
      queueMicrotask(() => input?.focus())
    }
  })
  createEffect(
    on(
      () => stack().length,
      () => setQuery(""),
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => root() && tab() === "all" && text(),
      (now, was) => {
        if (now || was) typeMessageQuery(now || "")
      },
      { defer: true },
    ),
  )
  createEffect(() => view().parent?.onQuery?.(query()))
  createEffect(
    on(
      () => view().parent,
      (_now, before) => before?.onQuery?.(""),
      { defer: true },
    ),
  )

  const preview = createPreview()
  let engaged = false
  createEffect(() => {
    const key = highlight()
    const item = items().find((i) => i.key === key)
    if (engaged && open()) preview.show(item)
  })
  createEffect(
    on(
      () => `${stack().join("/")}|${tab()}`,
      () => {
        engaged = false
        setHighlight("")
        preview.restore()
      },
      { defer: true },
    ),
  )
  onCleanup(() => preview.restore())

  const [actionsOpen, setActionsOpen] = createSignal(false)
  const [actionAt, setActionAt] = createSignal(0)
  const [peek, setPeek] = createSignal(false)
  const rowActions = (): readonly RowAction[] => current()?.actions?.() ?? []
  createEffect(
    on(
      () => `${highlight()}|${tab()}|${stack().length}`,
      () => {
        setActionsOpen(false)
        setPeek(false)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => `${tab()}|${stack().length}`,
      () => setPicks(new Set()),
      { defer: true },
    ),
  )

  const [glide, setGlide] = createSignal<{ y: number; h: number } | null>(null)
  const [pill, setPill] = createSignal<{ x: number; w: number } | null>(null)
  const [ready, setReady] = createSignal(false)
  createEffect(() => {
    highlight()
    groups()
    tab()
    const frame = requestAnimationFrame(() => {
      const el = list?.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')
      setGlide(el ? { y: el.offsetTop, h: el.offsetHeight } : null)
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })
  createEffect(() => {
    tab()
    const shown = root() && open()
    const frame = requestAnimationFrame(() => {
      const el = tabsEl?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (el && tabsEl && tabsEl.scrollWidth > tabsEl.clientWidth) revealTab(tabsEl, el)
      setPill(shown && el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
      requestAnimationFrame(() => setReady(true))
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })
  createEffect(() => {
    if (!open()) setReady(false)
  })

  const close = () => {
    preview.restore()
    closePalette()
    const el = before
    before = null
    if (el instanceof HTMLElement && el.isConnected) el.focus()
  }

  const choose = (item: ReturnType<typeof items>[number]) => {
    if (item.submenu) return enterView(item.submenu)
    if (item.folder) return item.run()
    preview.keep()
    close()
    item.run()
  }

  const entries = (): FileEntry[] => {
    const paths = pickedFiles()
    return props.source.files.filter((e) => paths.has(e.path))
  }
  const togglePick = (path: string) => {
    const next = new Set(pickedFiles())
    if (!next.delete(path)) next.add(path)
    setPicks(next)
  }
  const fileItems = () => items().filter((i) => i.file)
  const attach = () => {
    const picked = entries()
    if (!attachable(picked).length || !canAttach()) return
    close()
    attachFiles(picked)
  }
  const ask = () => {
    if (!root() || !text()) return
    close()
    askKiko(text())
  }
  let anchor = ""
  const rangePick = (path: string) => {
    const files = fileItems().map((i) => i.file!)
    const a = files.indexOf(anchor)
    const b = files.indexOf(path)
    if (a < 0 || b < 0) return togglePick(path)
    const next = new Set(pickedFiles())
    for (const p of files.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p)
    setPicks(next)
  }
  const pickFrom = (path: string, event: MouseEvent) => {
    if (event.shiftKey && anchor) rangePick(path)
    else togglePick(path)
    anchor = path
  }
  let extending = false
  createEffect(() => {
    const now = current()
    if (!extending || !now?.file) return
    extending = false
    setPicks(new Set([...pickedFiles(), now.file]))
  })

  const runAction = (action: RowAction | undefined) => {
    if (!action) return
    close()
    action.run()
  }

  const actionKeys = (e: KeyboardEvent) => {
    const list = rowActions()
    if (e.key === "ArrowDown") setActionAt((n) => (n + 1) % list.length)
    else if (e.key === "ArrowUp") setActionAt((n) => (n - 1 + list.length) % list.length)
    else if (e.key === "Enter") runAction(list[actionAt()])
    else if (e.key === "Escape" || e.key === "ArrowLeft") setActionsOpen(false)
    else if (e.key !== "Tab") return
    e.preventDefault()
    e.stopPropagation()
  }

  const perform = (intent: Intent) => {
    const item = current()
    switch (intent) {
      case "close":
        return close()
      case "unpeek":
        return setPeek(false)
      case "clear-picks":
        return setPicks(new Set<string>())
      case "next-tab":
        return stepTab(1)
      case "previous-tab":
        return stepTab(-1)
      case "folder-up":
        return openFolder(filesFolder().slice(0, -1))
      case "leave-view":
        return backView()
      case "actions":
        setActionAt(0)
        return setActionsOpen(true)
      case "attach":
        return attach()
      case "ask":
        return ask()
      case "open-folder":
        return item?.run()
      case "toggle-peek":
        return setPeek((p) => !p)
      case "pick":
        return item?.file ? togglePick(item.file) : undefined
      case "pick-all":
        return setPicks(new Set(fileItems().map((i) => i.file!)))
      case "extend":
        if (item?.file) setPicks(new Set([...pickedFiles(), item.file]))
        extending = true
        return undefined
      case "trap-tab":
        return undefined
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (actionsOpen()) return actionKeys(e)
    const item = current()
    const intent = intentOf(e, {
      root: root(),
      files: filesTab(),
      empty: query() === "",
      peeking: peek(),
      picked: pickedFiles().size,
      inFolder: filesFolder().length > 0,
      inView: backspaceLeaves(stack(), query()),
      hasActions: rowActions().length > 0,
      onFile: Boolean(item?.file),
      onFolder: Boolean(item?.folder),
    })
    if (!intent) return
    perform(intent)
    if (intent === "extend") return
    e.preventDefault()
    e.stopPropagation()
  }

  let pointer = { x: Number.NaN, y: Number.NaN }
  const onListPointer = (e: PointerEvent) => {
    if (e.clientX === pointer.x && e.clientY === pointer.y) return
    pointer = { x: e.clientX, y: e.clientY }
    const row = (e.target as HTMLElement).closest<HTMLElement>("[cmdk-item]")
    const key = row?.dataset.value
    if (key && row.getAttribute("aria-disabled") !== "true" && key !== highlight()) setHighlight(key)
  }

  const onListClick = (e: MouseEvent) => {
    if (!filesTab() || !(e.metaKey || e.ctrlKey || e.shiftKey)) return
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-kind="file"]')
    const path = items().find((i) => i.key === row?.dataset.value)?.file
    if (!path) return
    e.preventDefault()
    e.stopImmediatePropagation()
    pickFrom(path, e)
  }

  const typed = () => text() !== ""
  const loading = () => root() && tab() === "all" && typed() && messageStatus() === "loading"
  const emptyView = (): { message: string; sub?: string; ask?: boolean } | undefined => {
    if (groups().length) return undefined
    if (searching()) return { message: emptyText(view().parent, query()) }
    if (typed()) {
      const broken = root() && tab() === "all" && messageStatus() === "error"
      return {
        message: `No match for “${text()}”`,
        sub: broken ? "Search is not reachable. Kiko can look it up for you." : "Kiko can look it up for you.",
        ask: root(),
      }
    }
    return { message: root() ? EMPTY_TEXT[tab()]! : "No results" }
  }
  const selectedSize = () => formatBytes(entries().reduce((n, e) => n + e.size, 0))
  const peekEntry = () => props.source.files.find((e) => e.path === current()?.file)

  return (
    <Show when={kept()}>
      <Portal mount={document.body}>
        <div
          class="palette-scrim"
          data-component="palette"
          ref={(el) => {
            const engage = (event: Event) => {
              if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === "Escape")) return
              engaged = true
            }
            el.addEventListener("keydown", engage, true)
            el.addEventListener("pointermove", engage, true)
          }}
          data-closing={open() ? undefined : ""}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <Cmdk
            class="palette-panel"
            data-testid="palette-panel"
            label="Command palette"
            loop
            disablePointerSelection
            value={highlight()}
            onValueChange={setHighlight}
            shouldFilter={false}
            onKeyDown={onKeyDown}
          >
            <div class="palette-bar">
              <span class="palette-addon" aria-hidden="true">
                <RemixIcon icon={view().parent ? iconFor(view().parent!.icon) : SearchIcon} size={14} />
              </span>
              <Cmdk.Input
                ref={input}
                class="palette-input"
                placeholder={root() && narrow() ? "Search or ask" : view().placeholder}
                value={query()}
                onValueChange={setQuery}
                autofocus
              />
              <kbd class="palette-esc">Esc</kbd>
            </div>
            <Show when={root()}>
              <div class="palette-tabs" role="tablist" aria-label="Search in" ref={tabsEl}>
                <Show when={pill()}>
                  {(at) => (
                    <span
                      class="palette-pill"
                      data-ready={ready() ? "" : undefined}
                      style={{ transform: `translateX(${at().x}px)`, width: `${at().w}px` }}
                    />
                  )}
                </Show>
                <For each={TABS}>
                  {(t) => (
                    <button
                      type="button"
                      role="tab"
                      class="palette-tab"
                      tabindex="-1"
                      aria-selected={tab() === t.id}
                      data-tab={t.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseTab(t.id)}
                    >
                      {t.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={filesTab() && filesFolder().length}>
              <nav class="palette-crumbs" aria-label="Folder path">
                <For each={filesCrumbs(filesFolder())}>
                  {(label, i) => (
                    <>
                      <Show when={i() > 0}>
                        <RemixIcon icon={ChevronRightIcon} size={12} class="palette-crumb-sep" />
                      </Show>
                      <button
                        type="button"
                        class="palette-crumb"
                        data-last={i() === filesFolder().length ? "" : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openFolder(filesFolder().slice(0, i()))}
                      >
                        {label}
                      </button>
                    </>
                  )}
                </For>
              </nav>
            </Show>
            <div class="palette-body" data-side={actionsOpen() || peek() ? "" : undefined}>
              <Show when={root() && typed() && tab() === "all" && groups().length > 0}>
                <AskKiko query={text()} onAsk={ask} />
              </Show>
              <Cmdk.List
                class="palette-list"
                ref={(el) => {
                  list = el
                  el.addEventListener("click", onListClick, true)
                  el.addEventListener("pointermove", onListPointer)
                }}
              >
                <Show when={glide()}>
                  {(at) => (
                    <div
                      class="palette-glide"
                      data-ready={ready() ? "" : undefined}
                      style={{ transform: `translateY(${at().y}px)`, height: `${at().h}px` }}
                      aria-hidden="true"
                    />
                  )}
                </Show>
                <Show when={emptyView()}>
                  {(state) => (
                    <Show when={!loading()} fallback={<Skeleton />}>
                      <Empty message={state().message} sub={state().sub} onAsk={state().ask ? ask : undefined} />
                    </Show>
                  )}
                </Show>
                <Show when={!emptyView() && loading() && groups().length === 0}>
                  <Skeleton />
                </Show>
                <For each={groups()}>
                  {(group) => (
                    <Cmdk.Group class="palette-group" heading={group.label ?? undefined}>
                      <For each={group.items}>
                        {(item) => (
                          <Row
                            item={item}
                            selecting={pickedFiles().size > 0}
                            picked={item.file ? pickedFiles().has(item.file) : false}
                            onSelect={() => choose(item)}
                            onPick={(event) => item.file && pickFrom(item.file, event)}
                          />
                        )}
                      </For>
                    </Cmdk.Group>
                  )}
                </For>
              </Cmdk.List>
              <Show when={actionsOpen()}>
                <Actions actions={rowActions()} at={actionAt()} onAt={setActionAt} onRun={runAction} />
              </Show>
              <Show when={peek() && peekEntry()}>{(entry) => <Peek entry={entry()} />}</Show>
            </div>
            <Show
              when={pickedFiles().size === 0}
              fallback={
                <div class="palette-selbar" data-component="palette-selection">
                  <span class="palette-selcount">
                    <b>{pickedFiles().size} selected</b> {selectedSize()}
                  </span>
                  <button type="button" class="palette-btn" onClick={() => downloadFiles(entries())}>
                    <RemixIcon icon={DownloadIcon} size={13} />
                    Download
                  </button>
                  <Show when={canAttach()}>
                    <Show
                      when={attachable(entries()).length > 0}
                      fallback={
                        <span class="type-xs text-quaternary" data-component="palette-attach-other">
                          Files from other chats stay in their chat
                        </span>
                      }
                    >
                      <button type="button" class="palette-btn" data-primary="" onClick={attach}>
                        {attachable(entries()).length < entries().length
                          ? "Attach the ones from this chat"
                          : "Attach to message"}
                        <Key name="mod-enter" />
                      </button>
                    </Show>
                  </Show>
                </div>
              }
            >
              <div class="palette-footer">
                <Show
                  when={root()}
                  fallback={
                    <>
                      <Hint name="up-down">Navigate</Hint>
                      <Hint name="enter">{enterLabel(view())}</Hint>
                      <Show when={stack().length > 0}>
                        <span class="palette-hint">
                          <kbd class="palette-kbd">Backspace</kbd>Back
                        </span>
                      </Show>
                      <Hint name="esc">Close</Hint>
                    </>
                  }
                >
                  <Show
                    when={filesTab()}
                    fallback={
                      <>
                        <Show when={items().length}>
                          <Hint name="up-down">Move</Hint>
                          <Hint name="enter">Open</Hint>
                        </Show>
                        <Show when={current()?.actions}>
                          <Hint name="alt-enter">Actions</Hint>
                        </Show>
                        <Hint name="tab">Change tab</Hint>
                        <Show when={typed() && tab() === "all"}>
                          <span class="palette-hint palette-hint-end">
                            Ask Kiko
                            <Key name="mod-enter" />
                          </span>
                        </Show>
                      </>
                    }
                  >
                    <Hint name="right">{current()?.folder ? "Open folder" : "Preview"}</Hint>
                    <Show when={filesFolder().length}>
                      <Hint name="left">Back</Hint>
                    </Show>
                    <Hint name="space">Select</Hint>
                    <span class="palette-hint palette-hint-end">
                      <Key name="tab" />
                      Change tab
                    </span>
                  </Show>
                </Show>
              </div>
            </Show>
          </Cmdk>
        </div>
      </Portal>
    </Show>
  )
}
