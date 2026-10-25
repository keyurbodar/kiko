import { humanHandle } from "@kiko/protocol"
import { createContext, Show, useContext, type JSX } from "solid-js"
import { session } from "../../app/session"
import { AgentChip } from "./agent-chip"

export const MentionLookup = createContext<(slug: string) => { name: string } | undefined>(() => undefined)

export function Mention(props: { slug: string; text?: string }): JSX.Element {
  const lookup = useContext(MentionLookup)
  const member = () => lookup(props.slug)
  const self = () => {
    const s = session()
    return s.status === "signed-in" && humanHandle(s.user.name) === props.slug
  }
  const plain = () => (
    <Show when={self()} fallback={<span class="font-medium">{props.text ?? `@${props.slug}`}</span>}>
      <span class="mchip" data-component="chat-mention" data-self="" data-slug={props.slug}>
        <span class="mchip-label">@{props.slug}</span>
      </span>
    </Show>
  )
  return (
    <Show when={member()} fallback={plain()}>
      {(m) => <AgentChip slug={props.slug} name={m().name} />}
    </Show>
  )
}
