import { For, Match, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { RichText as RichTextTree } from "@kiko/protocol"
import { EmojiText } from "../../lib/emoji"
import { Mention } from "../ui/Mention"
import { CodeBlock } from "./CodeBlock"
import { richNodes, type RichNode } from "./model"
import "./rich.css"

function Node(props: { node: RichNode }): JSX.Element {
  return (
    <Switch>
      <Match when={props.node.kind === "text" && props.node}>
        {(n) => <EmojiText text={(n() as { text: string }).text} />}
      </Match>
      <Match when={props.node.kind === "mention" && props.node}>{(n) => <Mention slug={(n() as { slug: string }).slug} />}</Match>
      <Match when={props.node.kind === "code" && props.node}>
        {(n) => <CodeBlock lang={(n() as { lang?: string }).lang} text={(n() as { text: string }).text} />}
      </Match>
      <Match when={props.node.kind === "el" && props.node}>
        {(n) => {
          const e = () => n() as Extract<RichNode, { kind: "el" }>
          return (
            <Dynamic component={e().tag} {...e().attrs}>
              <For each={e().children}>{(child) => <Node node={child} />}</For>
            </Dynamic>
          )
        }}
      </Match>
    </Switch>
  )
}

/**
 * Renders the tree the server parsed. No markdown parser and no innerHTML. Text runs draw
 * their emoji as artwork and a mention as the member's chip, both inline.
 */
export function RichText(props: { tree: RichTextTree; class?: string }): JSX.Element {
  return (
    <div class={`rich${props.class ? ` ${props.class}` : ""}`}>
      <For each={richNodes(props.tree)}>{(node) => <Node node={node} />}</For>
    </div>
  )
}
