import { For, Match, Suspense, Switch, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CollapseIcon, CopyIcon, ExpandIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Dynamic } from "solid-js/web"
import { plainText, type RichText as RichTextTree } from "@kiko/protocol"
import { EmojiText } from "../../lib/emoji"
import { FileChip } from "../ui/FileChip"
import { Mention } from "../ui/Mention"
import { CodeBlock } from "./CodeBlock"
import { LinkIcon } from "./LinkIcon"
import { linkHost, linkLead, richNodes, type RichNode, type TableCopy } from "./model"
import { PlainFallback } from "./plain-fallback"
import { RichImage } from "./RichImage"
import "./rich.css"
import { SuspiciousLinkDialog } from "../ui/SuspiciousLinkDialog"

function Node(props: { node: RichNode; onMasked: (href: string) => void }): JSX.Element {
  return (
    <Switch>
      <Match when={props.node.kind === "text" && props.node}>
        {(n) => <EmojiText text={(n() as { text: string }).text} />}
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
        {(n) => <CodeBlock lang={(n() as { lang?: string }).lang} text={(n() as { text: string }).text} />}
      </Match>
      <Match when={props.node.kind === "masked" && props.node}>
        {(n) => {
          const m = () => n() as Extract<RichNode, { kind: "masked" }>
          return (
            <button
              type="button"
              class="cursor-pointer text-inherit underline underline-offset-2"
              data-component="chat-masked-link"
              onClick={() => props.onMasked(m().href)}
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

function IconLead(props: { host: string; nodes: RichNode[]; onMasked: (href: string) => void }): JSX.Element {
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
  onMount(() => {
    fade()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fade)
    if (scroller) observer?.observe(scroller)
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
    <div class="rich-table" ref={root} data-expanded={expanded() ? "true" : "false"} data-component="chat-table">
      <div class="rich-table-scroll" ref={scroller} onScroll={fade}>
        {props.children}
      </div>
      <div class="rich-table-footer">
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
              <RemixIcon icon={copied() ? CheckIcon : CopyIcon} class="size-3" />
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

function RichTree(props: { tree: RichTextTree; class?: string }): JSX.Element {
  const [maskedHref, setMaskedHref] = createSignal<string | null>(null)
  return (
    <>
      <div class={`rich${props.class ? ` ${props.class}` : ""}`}>
        <For each={richNodes(props.tree)}>{(node) => <Node node={node} onMasked={setMaskedHref} />}</For>
      </div>
      <Show when={maskedHref()}>
        {(href) => (
          <Suspense>
            <SuspiciousLinkDialog href={href()} onClose={() => setMaskedHref(null)} />
          </Suspense>
        )}
      </Show>
    </>
  )
}

export function RichText(props: { tree: RichTextTree; class?: string }): JSX.Element {
  return (
    <PlainFallback text={plainText(props.tree)}>
      <RichTree tree={props.tree} class={props.class} />
    </PlainFallback>
  )
}
