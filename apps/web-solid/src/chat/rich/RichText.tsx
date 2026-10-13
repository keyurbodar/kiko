import { For, Match, Suspense, Switch, createSignal, lazy, onCleanup, Show, type JSX } from "solid-js"
import { CheckIcon, CopyIcon, Maximize2Icon } from "lucide-solid"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Dynamic } from "solid-js/web"
import type { RichText as RichTextTree } from "@kiko/protocol"
import { EmojiText } from "../../lib/emoji"
import { FileChip } from "../ui/FileChip"
import { Mention } from "../ui/Mention"
import { CodeBlock } from "./CodeBlock"
import { richNodes, type RichNode } from "./model"
import "./rich.css"

const SuspiciousLinkDialog = lazy(() => import("../ui/SuspiciousLinkDialog").then((m) => ({ default: m.SuspiciousLinkDialog })))

function Node(props: { node: RichNode; onMasked: (href: string) => void }): JSX.Element {
  return (
    <Switch>
      <Match when={props.node.kind === "text" && props.node}>
        {(n) => <EmojiText text={(n() as { text: string }).text} />}
      </Match>
      <Match when={props.node.kind === "mention" && props.node}>{(n) => <Mention slug={(n() as { slug: string }).slug} />}</Match>
      <Match when={props.node.kind === "file" && props.node}>
        {(n) => {
          const f = () => n() as Extract<RichNode, { kind: "file" }>
          return <FileChip file={f().file} label={f().label} bare={f().bare} />
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
          const children = () => <For each={e().children}>{(child) => <Node node={child} onMasked={props.onMasked} />}</For>
          if (e().attrs.class === "rich-table-scroll") return <RichTable>{children()}</RichTable>
          if (e().tag === "a") {
            // The URL shows on hover, as t3code's link does, so the link itself carries no native title.
            return (
              <TooltipV2 placement="top" value={e().attrs.href ?? ""}>
                <Dynamic component="a" {...e().attrs}>
                  {children()}
                </Dynamic>
              </TooltipV2>
            )
          }
          return (
            <Dynamic component={e().tag} {...e().attrs}>
              {children()}
            </Dynamic>
          )
        }}
      </Match>
    </Switch>
  )
}

/** A table with t3code's footer: a toggle that wraps or truncates its cells, and a copy of its rows as tab-separated text. */
function RichTable(props: { children: JSX.Element }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  let root: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  // Wrapping cells would narrow the columns, so pin each header cell to its current width first, as t3code does.
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
  const copy = async () => {
    const table = root?.querySelector("table")
    if (!table) return
    const text = [...table.rows].map((row) => [...row.cells].map((cell) => cell.textContent ?? "").join("\t")).join("\n")
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
      <div class="rich-table-scroll">{props.children}</div>
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
            <Maximize2Icon class="size-3.5" aria-hidden="true" />
          </button>
        </TooltipV2>
        <TooltipV2 placement="top" value={copied() ? "Copied" : "Copy table"}>
          <button type="button" class="rich-table-action" aria-label={copied() ? "Copied" : "Copy table"} onClick={copy}>
            {copied() ? <CheckIcon class="size-3.5" aria-hidden="true" /> : <CopyIcon class="size-3.5" aria-hidden="true" />}
          </button>
        </TooltipV2>
      </div>
    </div>
  )
}

/**
 * Renders the tree the server parsed. No markdown parser and no innerHTML. Text runs set
 * their emoji in the emoji font, a mention as the member's chip, and a file as a chip that
 * opens it in the files tab, all inline. A masked link opens the warning before it goes anywhere.
 */
export function RichText(props: { tree: RichTextTree; class?: string }): JSX.Element {
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
