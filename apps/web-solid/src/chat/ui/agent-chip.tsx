import { IdentityAvatar } from "../../lib/IdentityAvatar"
import "./chips.css"

export function AgentChip(props: { slug: string; name: string }) {
  return (
    <span class="mchip" data-component="chat-mention" data-slug={props.slug} title={props.name}>
      <IdentityAvatar seed={props.slug} size={16} />
      <span class="mchip-label">{props.name}</span>
    </span>
  )
}
