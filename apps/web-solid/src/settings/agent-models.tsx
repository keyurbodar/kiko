import { ProviderIcon } from "@kiko/ui/provider-icon"
import type { Member, ThinkingLevel } from "@kiko/protocol"
import { createSignal, For, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { levelFor } from "./agent-model"
import { connectedProviders } from "./connected"
import { Group, Row } from "./kit"
import { ModelPicker } from "./model-picker"
import { hasModelProvider } from "./provider-kinds"
import { ReasoningMenu } from "./reasoning-menu"

function AgentRow(props: { member: Member }) {
  const [open, setOpen] = createSignal(false)
  const set = (ref: string, thinking?: ThinkingLevel, levels?: readonly ThinkingLevel[]) => useApp.room()?.model(props.member.slug, ref, thinking, levels)
  return (
    <Row
      data-agent={props.member.slug}
      label={
        <span class="flex items-center gap-2">
          <IdentityAvatar seed={props.member.slug} size={20} />
          {props.member.name}
        </span>
      }
    >
      <ModelPicker
        current={props.member.model}
        open={open()}
        onOpenChange={setOpen}
        onPick={(ref, levels) => ref !== props.member.model && set(ref, levelFor(levels, props.member.thinking), levels)}
        title={`Choose model for ${props.member.name}`}
        class="flex h-7 max-w-[240px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <Show when={props.member.model?.split("/")[0]}>{(provider) => <ProviderIcon id={provider()} width="13" height="13" />}</Show>
        <span class="truncate" data-field="model">{props.member.model?.split("/").slice(1).join("/")}</span>
      </ModelPicker>
      <ReasoningMenu levels={props.member.thinkingLevels} value={props.member.thinking} placement="bottom-end" onChange={(level) => set(props.member.model ?? "", level)} />
    </Row>
  )
}

/** Each agent of the open chat with its model and reasoning level. Hidden until a chat is open. */
export function AgentModels() {
  const members = () => useApp.roomMembers()
  return (
    <Show when={hasModelProvider(connectedProviders()) && members().length}>
      <Group title={`Agents in ${useApp.chatById(useApp.activeThreadId() ?? "")?.name ?? "this chat"}`} description="Each agent in a chat has its own model and reasoning level." data-component="agent-models">
        <For each={members()}>{(member) => <AgentRow member={member} />}</For>
      </Group>
    </Show>
  )
}
