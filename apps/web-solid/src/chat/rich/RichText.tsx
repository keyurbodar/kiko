import { For, Match, Suspense, Switch, createSignal, lazy, Show, type JSX } from "solid-js"
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
          return <FileChip file={f().file} label={f().label} />
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
          return (
            <Dynamic component={e().tag} {...e().attrs}>
              <For each={e().children}>{(child) => <Node node={child} onMasked={props.onMasked} />}</For>
            </Dynamic>
          )
        }}
      </Match>
    </Switch>
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
