import { ProviderIcon } from "@kiko/ui/provider-icon"
import type { AgentSlug } from "@kiko/protocol"
import { createSignal, For, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { user } from "../state/user"
import { Group, Row } from "./kit"
import { ModelPicker } from "./model-picker"
import { ReasoningMenu } from "./reasoning-menu"
import { useLiveModel } from "./catalog"
import { modelIdOf, providerOf } from "./model-list"

function AgentRow(props: { slug: AgentSlug; name: string }) {
  const [open, setOpen] = createSignal(false)
  const current = useLiveModel(() => user.agentModel(props.slug))
  return (
    <Row
      data-agent={props.slug}
      label={
        <span class="flex items-center gap-3 py-1 text-label font-semibold">
          <IdentityAvatar seed={props.slug} size={36} />
          {props.name}
        </span>
      }
    >
      <ModelPicker
        current={current()?.model}
        open={open()}
        onOpenChange={setOpen}
        onPick={(ref, levels, name) =>
          ref !== current()?.model && room.setAgentModel(props.slug, { ref, levels, name })
        }
        title={`Choose model for ${props.name}`}
        class="flex h-8 max-w-[240px] min-w-0 items-center gap-1.5 rounded-control bg-[var(--raise)] px-3 text-label text-fg transition-colors duration-[var(--dur-hover)] hover:bg-[var(--fill-control-hover)] aria-expanded:bg-[var(--fill-control-hover)] active:scale-[0.98]"
      >
        <Show when={providerOf(current()?.model)}>
          {(provider) => <ProviderIcon id={provider()} width="13" height="13" />}
        </Show>
        <span class="truncate" data-field="model">
          {current()?.name ?? modelIdOf(current()?.model) ?? "Choose model"}
        </span>
      </ModelPicker>
      <ReasoningMenu
        levels={current()?.thinkingLevels}
        value={current()?.thinking}
        placement="bottom-end"
        class="h-8 rounded-control bg-[var(--raise)] px-3 text-label text-fg"
        onChange={(thinking) => room.setAgentModel(props.slug, { thinking })}
      />
    </Row>
  )
}

export function AgentModels() {
  return (
    <Group
      title="Your agents"
      description="Each agent keeps its own model and reasoning level in every chat."
      data-component="agent-models"
    >
      <For each={user.modelAgents()}>{(agent) => <AgentRow slug={agent.slug} name={agent.name} />}</For>
    </Group>
  )
}
