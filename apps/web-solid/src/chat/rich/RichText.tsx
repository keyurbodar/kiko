import { For, Match, Suspense, Switch, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, CollapseIcon, ExpandIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { Dynamic } from "solid-js/web"
import { plainText, type RichText as RichTextTree } from "@kiko/protocol"
import { EmojiText } from "../../lib/emoji"
import { FileChip } from "../ui/FileChip"
import { Mention } from "../ui/Mention"
import { TokenText } from "./token-chips"
import { CodeBlock } from "./CodeBlock"
import { LinkIcon } from "./LinkIcon"
import { linkHost, linkLead, richNodes, type RichNode, type TableCopy } from "./model"
import { PlainFallback } from "./plain-fallback"
import { RichImage } from "./RichImage"
import "./rich.css"
import { SuspiciousLinkDialog } from "../ui/SuspiciousLinkDialog"

type Masked = { href: string; text: string }

function Node(props: { node: RichNode; onMasked: (link: Masked) => void }): JSX.Element {
  return (
    <Switch>
      <Match when={props.node.kind === "text" && props.node}>
        {(n) => <TokenText text={(n() as { text: string }).text} />}
      </Match>
      <Match when={props.node.kind === "mention" && props.node}>
        {(n) => <Mention slug={(n() as { slug: string }).slug} />}
      </Match>
      <Match when={props.node.kind === "file" && props.node}>
        {(n) => {
          const f = () => n() as Extract<RichNode, { kind: "file" }>
          return <FileChip file={f().file} label={f().label} bare={f().bare} />
        }}
      </Match>
      <Match when={props.node.kind === "image" && props.node}>
        {(n) => {
          const i = () => n() as Extract<RichNode, { kind: "image" }>
          return <RichImage alt={i().alt} url={i().url} fileId={i().fileId} />
        }}
      </Match>
      <Match when={props.node.kind === "code" && props.node}>
        {(n) => <CodeBlock files={(n() as Extract<RichNode, { kind: "code" }>).files} />}
      </Match>
      <Match when={props.node.kind === "masked" && props.node}>
        {(n) => {
          const m = () => n() as Extract<RichNode, { kind: "masked" }>
          return (
            <button
              type="button"
              class="cursor-pointer text-inherit underline underline-offset-2"
              data-component="chat-masked-link"
              onClick={(e) => props.onMasked({ href: m().href, text: e.currentTarget.textContent?.trim() ?? "" })}
            >
              <For each={m().children}>{(child) => <Node node={child} onMasked={props.onMasked} />}</For>
            </button>
          )
        }}
      </Match>
      <Match when={props.node.kind === "el" && props.node}>
        {(n) => {
          const e = () => n() as Extract<RichNode, { kind: "el" }>
          const children = () => (
            <For each={e().children}>{(child) => <Node node={child} onMasked={props.onMasked} />}</For>
          )
          if (e().attrs.class === "rich-table-scroll") return <RichTable copy={e().copy}>{children()}</RichTable>
          if (e().tag === "a") {
            return (
              <TooltipV2 class="rich-link-anchor" placement="top" value={e().attrs.href ?? ""}>
                <Dynamic component="a" {...e().attrs}>
                  <Show when={linkHost(e().attrs.href ?? "")} fallback={children()}>
                    {(host) => <IconLead host={host()} nodes={e().children} onMasked={props.onMasked} />}
                  </Show>
                </Dynamic>
              </TooltipV2>
            )
          }
          const style = () => (e().tag === "ol" ? orderedGutter(e().attrs.start, e().children.length) : undefined)
          return (
            <Dynamic component={e().tag} {...e().attrs} style={style()}>
              {children()}
            </Dynamic>
          )
        }}
      </Match>
    </Switch>
  )
}

function IconLead(props: { host: string; nodes: RichNode[]; onMasked: (link: Masked) => void }): JSX.Element {
  const first = () => props.nodes[0]
  const lead = () => {
    const n = first()
    return n?.kind === "text" ? linkLead(n.text) : null
  }
  return (
    <>
      <span class="rich-link-lead">
        <LinkIcon host={props.host} />
        <Show when={lead()}>{(l) => l()[0]}</Show>
        <Show when={!lead() && first()}>{(n) => <Node node={n()} onMasked={props.onMasked} />}</Show>
      </span>
      <Show when={lead()}>{(l) => <EmojiText text={l()[1]} />}</Show>
      <For each={props.nodes.slice(1)}>{(child) => <Node node={child} onMasked={props.onMasked} />}</For>
    </>
  )
}

function orderedGutter(start: string | undefined, count: number): { "--list-gutter": string } | undefined {
  const first = Number.parseInt(start ?? "1", 10)
  if (!Number.isSafeInteger(first) || count < 1) return undefined
  const width = Math.max(String(first).length, String(first + count - 1).length)
  return width <= 1 ? undefined : { "--list-gutter": `${width + 2}ch` }
}

const TABLE_ROWS_SHOWN = 4

const TABLE_FOLD_AFTER = 6

function RichTable(props: { children: JSX.Element; copy?: TableCopy }): JSX.Element {
  const [expanded, setExpanded] = createSignal(true)
  const [copied, setCopied] = createSignal(false)
  let root: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const fade = () => {
    if (!scroller) return
    scroller.style.setProperty("--overflow-start", `${scroller.scrollLeft}px`)
    scroller.style.setProperty(
      "--overflow-end",
      `${Math.max(0, scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft)}px`,
    )
  }
  const [rows, setRows] = createSignal(0)
  const [allRows, setAllRows] = createSignal(false)
  const folded = () => !allRows() && rows() > TABLE_FOLD_AFTER
  onMount(() => {
    setRows(root?.querySelectorAll("tbody tr").length ?? 0)
    fade()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fade)
    if (scroller) observer?.observe(scroller)
    const table = root?.querySelector("table")
    if (table) observer?.observe(table)
    onCleanup(() => observer?.disconnect())
  })

  const toggle = () => {
    const table = root?.querySelector("table")
    if (table && !expanded()) {
      const widths: number[] = []
      for (const row of table.rows) {
        ;[...row.cells].forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.getBoundingClientRect().width)))
      }
      ;[...(table.tHead?.rows[0]?.cells ?? [])].forEach((cell, i) => (cell.style.minWidth = `${widths[i] ?? 0}px`))
    }
    setExpanded(!expanded())
  }
  const copy = async (text: string | undefined) => {
    if (text === undefined) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div
      class="rich-table"
      ref={root}
      data-expanded={expanded() ? "true" : "false"}
      data-rows-folded={folded() ? "" : undefined}
      data-component="chat-table"
    >
      <div class="rich-table-scroll" ref={scroller} onScroll={fade}>
        {props.children}
      </div>
      <div class="rich-table-footer">
        <Show when={folded()} fallback={<span />}>
          <button type="button" class="rich-table-more" data-disclosure="" onClick={() => setAllRows(true)}>
            <RemixIcon icon={ChevronDownIcon} size={12} />
            Show {rows() - TABLE_ROWS_SHOWN} more
          </button>
        </Show>
        <span class="ml-auto" />
        <TooltipV2 placement="top" value={expanded() ? "Collapse table cells" : "Expand table cells"}>
          <button
            type="button"
            class="rich-table-action"
            aria-pressed={expanded()}
            data-active={expanded() ? "" : undefined}
            aria-label={expanded() ? "Collapse table cells" : "Expand table cells"}
            onClick={toggle}
          >
            <RemixIcon icon={expanded() ? CollapseIcon : ExpandIcon} class="size-3" />
          </button>
        </TooltipV2>
        <MenuV2 gutter={4} placement="bottom-end">
          <TooltipV2 placement="top" value={copied() ? "Copied" : "Copy table"}>
            <MenuV2.Trigger class="rich-table-action" aria-label={copied() ? "Copied" : "Copy table"}>
              <CopyCheckIcon copied={copied()} size={12} />
            </MenuV2.Trigger>
          </TooltipV2>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-40">
              <MenuV2.Item onSelect={() => copy(props.copy?.markdown)}>Copy as Markdown</MenuV2.Item>
              <MenuV2.Item onSelect={() => copy(props.copy?.csv)}>Copy as CSV</MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </div>
  )
}

type RichTextProps = {
  tree: RichTextTree
  class?: string
  streaming?: boolean
  component?: string
  ref?: (element: HTMLDivElement) => void
  onScroll?: JSX.EventHandler<HTMLDivElement, Event>
}

function RichTree(props: RichTextProps): JSX.Element {
  const [masked, setMasked] = createSignal<Masked | null>(null)
  return (
    <>
      <div
        ref={props.ref}
        class={`rich${props.class ? ` ${props.class}` : ""}`}
        data-component={props.component}
        data-streaming={props.streaming ? "" : undefined}
        onScroll={props.onScroll}
      >
        <For each={richNodes(props.tree)}>{(node) => <Node node={node} onMasked={setMasked} />}</For>
      </div>
      <Show when={masked()}>
        {(link) => (
          <Suspense>
            <SuspiciousLinkDialog
              href={link().href}
              {...(link().text ? { text: link().text } : {})}
              onClose={() => setMasked(null)}
            />
          </Suspense>
        )}
      </Show>
    </>
  )
}

export function RichText(props: RichTextProps): JSX.Element {
  return (
    <PlainFallback text={plainText(props.tree)}>
      <RichTree {...props} />
    </PlainFallback>
  )
}
