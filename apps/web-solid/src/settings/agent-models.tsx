import { ProviderIcon } from "@kiko/ui/provider-icon"
import type { AgentSlug } from "@kiko/protocol"
import { createSignal, For, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { connectedProviders } from "./connected"
import { Group, Row } from "./kit"
import { ModelPicker } from "./model-picker"
import { hasModelProvider } from "./provider-kinds"
import { ReasoningMenu } from "./reasoning-menu"

function AgentRow(props: { slug: AgentSlug; name: string }) {
  const [open, setOpen] = createSignal(false)
  const current = () => useApp.agentModel(props.slug)
  return (
    <Row
      data-agent={props.slug}
      label={
        <span class="flex items-center gap-2">
          <IdentityAvatar seed={props.slug} size={20} />
          {props.name}
        </span>
      }
    >
      <ModelPicker
        current={current()?.model}
        open={open()}
        onOpenChange={setOpen}
        onPick={(ref, levels) => ref !== current()?.model && useApp.setAgentModel(props.slug, { ref, levels })}
        title={`Choose model for ${props.name}`}
        class="flex h-7 max-w-[240px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <Show when={current()?.model.split("/")[0]}>{(provider) => <ProviderIcon id={provider()} width="13" height="13" />}</Show>
        <span class="truncate" data-field="model">{current()?.model.split("/").slice(1).join("/") ?? "Choose model"}</span>
      </ModelPicker>
      <ReasoningMenu levels={current()?.thinkingLevels} value={current()?.thinking} placement="bottom-end" onChange={(thinking) => useApp.setAgentModel(props.slug, { thinking })} />
    </Row>
  )
}

/** Every agent the owner has, Kiko first, with its model and reasoning level. The same in every chat. */
export function AgentModels() {
  return (
    <Show when={hasModelProvider(connectedProviders())}>
      <Group title="Agents" description="Each agent keeps its own model and reasoning level in every chat." data-component="agent-models">
        <For each={useApp.modelAgents()}>{(agent) => <AgentRow slug={agent.slug} name={agent.name} />}</For>
      </Group>
    </Show>
  )
}
