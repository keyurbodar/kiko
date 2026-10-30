import { FileIcon } from "@kiko/ui/file-icon"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { BackIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import { folderLabel, ROOT, type TreeIndex } from "./model"
import { breadcrumbPathOf, fileCrumbs, folderChildren, navigableBack, type Breadcrumb } from "./explorer/path"
import "./explorer/breadcrumbs.css"

function labelOf(path: string) {
  return folderLabel(path)
}

export function FileBreadcrumbs(props: {
  current: string
  trail: string
  index: TreeIndex
  unsaved: boolean
  onNavigateFolder: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  let scroller: HTMLDivElement | undefined
  const [fade, setFade] = createSignal("")
  const crumbs = () => fileCrumbs(props.trail, props.index.folders)
  const currentIndex = () => crumbs().findIndex((crumb) => crumb.path === breadcrumbPathOf(props.current))

  const measure = () => {
    if (!scroller) return
    const max = scroller.scrollWidth - scroller.clientWidth
    const at = scroller.scrollLeft
    setFade([at > 0.5 ? "start" : "", at < max - 0.5 ? "end" : ""].filter(Boolean).join(" "))
  }

  const scrollToCurrent = () => {
    if (!scroller) return
    const items = scroller.querySelectorAll<HTMLElement>("[data-file-crumb]")
    items[items.length - 1]?.scrollIntoView({ block: "nearest", inline: "end" })
    scroller
      .querySelector<HTMLElement>('[data-current-file-crumb="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
    measure()
  }

  createEffect(on(() => [props.current, props.trail], scrollToCurrent))

  const visit = (crumb: Breadcrumb) => {
    if (crumb.kind === "file") props.onOpenFile(crumb.path)
    else props.onNavigateFolder(crumb.path)
  }

  return (
    <nav class="fb-nav" aria-label="File path" data-component="file-breadcrumbs">
      <div
        ref={(el) => {
          scroller = el
          const observer = new ResizeObserver(measure)
          observer.observe(el)
          onCleanup(() => observer.disconnect())
          queueMicrotask(scrollToCurrent)
        }}
        class="fb-scroll"
        data-fade={fade()}
        data-component="file-breadcrumb-scroll"
        onScroll={measure}
      >
        <ol class="fb-list">
          <For each={crumbs()}>
            {(crumb, index) => {
              const current = () => index() === currentIndex()
              return (
                <li class="fb-item" data-file-crumb data-current-file-crumb={current() ? "true" : undefined}>
                  <Show
                    when={current()}
                    fallback={
                      <TooltipV2 class="flex min-w-0" placement="top" value={crumb.path || crumb.label}>
                        <button
                          type="button"
                          class="fb-name"
                          data-descendant={index() > currentIndex() ? "" : undefined}
                          data-action="navigate-folder"
                          onClick={() => visit(crumb)}
                        >
                          {crumb.label}
                        </button>
                      </TooltipV2>
                    }
                  >
                    <TooltipV2 class="flex min-w-0" placement="top" value={crumb.path || crumb.label}>
                      <span class="fb-name" data-current aria-current="page">
                        {crumb.label}
                      </span>
                    </TooltipV2>
                    <Show when={props.unsaved && crumb.kind === "file"}>
                      <span
                        class="ml-1.5 size-1.5 shrink-0 rounded-full bg-[var(--fg3)]"
                        data-component="file-unsaved"
                        title="Saving"
                        role="img"
                        aria-label="Unsaved changes"
                      />
                    </Show>
                  </Show>
                  <Show when={index() < crumbs().length - 1}>
                    <FolderContentsMenu
                      dir={crumb.path}
                      current={props.current}
                      index={props.index}
                      onNavigateFolder={props.onNavigateFolder}
                      onOpenFile={props.onOpenFile}
                    />
                  </Show>
                </li>
              )
            }}
          </For>
        </ol>
      </div>
    </nav>
  )
}

function FolderContentsMenu(props: {
  dir: string
  current: string
  index: TreeIndex
  onNavigateFolder: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal(props.dir)
  createEffect(
    on(
      () => [props.dir, props.current] as const,
      () => {
        setOpen(false)
        setAt(props.dir)
      },
      { defer: true },
    ),
  )
  const change = (next: boolean) => {
    setOpen(next)
    if (next) setAt(props.dir)
  }
  const children = () => folderChildren(props.index, at())
  const back = () => navigableBack(props.dir, at())

  return (
    <MenuV2 open={open()} onOpenChange={change} placement="bottom-start" gutter={4}>
      <MenuV2.Trigger class="fb-chev" aria-label={`Browse ${labelOf(props.dir)}`} data-component="file-crumb-menu">
        <RemixIcon icon={ChevronRightIcon} size={14} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content
          class="max-h-80 min-w-48 overflow-y-auto"
          data-component="file-crumb-menu-content"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "ArrowLeft") return
            const parent = back()
            if (parent === null) return
            event.preventDefault()
            event.stopPropagation()
            setAt(parent)
          }}
        >
          <Show when={back()} keyed>
            {(parent) => (
              <>
                <MenuV2.Item closeOnSelect={false} onSelect={() => setAt(parent)} data-action="crumb-back">
                  <RemixIcon icon={BackIcon} class="size-4 shrink-0" />
                  <span class="truncate">Back to {labelOf(parent)}</span>
                </MenuV2.Item>
                <MenuV2.Separator />
              </>
            )}
          </Show>
          <Show when={children()} fallback={<MenuV2.Item disabled>This folder is no longer available.</MenuV2.Item>}>
            {(items) => (
              <Show when={items().length} fallback={<MenuV2.Item disabled>This folder is empty.</MenuV2.Item>}>
                <MenuV2.RadioGroup
                  value={props.current}
                  onChange={(path: string) => {
                    setOpen(false)
                    props.onOpenFile(path)
                  }}
                >
                  <For each={items()}>
                    {(item) =>
                      item.directory ? (
                        <MenuV2.Item closeOnSelect={false} onSelect={() => setAt(item.path)}>
                          <FileIcon node={{ path: item.path, type: "directory" }} />
                          <span class="min-w-0 flex-1 truncate">{item.label}</span>
                          <RemixIcon icon={ChevronRightIcon} class="size-4 shrink-0 text-fg3" />
                        </MenuV2.Item>
                      ) : (
                        <MenuV2.RadioItem
                          value={item.path}
                          aria-current={item.path === breadcrumbPathOf(props.current) ? "page" : undefined}
                        >
                          <FileIcon node={{ path: item.path, type: "file" }} />
                          <TooltipV2 class="min-w-0 flex-1" placement="right" value={item.path}>
                            <span class="block truncate">{item.label}</span>
                          </TooltipV2>
                        </MenuV2.RadioItem>
                      )
                    }
                  </For>
                </MenuV2.RadioGroup>
              </Show>
            )}
          </Show>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
