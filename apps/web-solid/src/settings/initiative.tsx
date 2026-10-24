import type { UserSettings } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { Show } from "solid-js"
import { Group, Row, Segmented, Skeleton } from "./kit"
import { createQuery, owner, run } from "../state/runtime"

type Settings = UserSettings
export type Level = Settings["initiative"]
export type Capture = Settings["capture"]

const HELP: Record<Level, string> = {
  off: "No initiative and no background judge cost.",
  chat: "Brings things up only inside replies.",
  digest: "At most one message a day.",
  active: "Up to three messages a day, one per chat.",
}
const DEFAULTS: Settings = { initiative: "digest", capture: "auto" }

async function save(patch: Partial<Pick<Settings, "initiative" | "capture">>): Promise<void> {
  if ((await run(owner.commands.settingsUpdate, { patch }))._tag === "Success") return
  showToastV2({ title: "Could not save that setting", variant: "error" })
}

export default function InitiativePage() {
  const remote = createQuery(() => owner.queries.settings(undefined))
  const loaded = () => remote() !== undefined || remote.error !== undefined
  const settings = () => remote() ?? DEFAULTS
  return (
    <div class="flex flex-col gap-8" data-component="initiative-settings">
      <Group title="Agents">
        <Row label="Initiative" id="initiative" description={HELP[settings().initiative]}>
          <Show when={loaded()} fallback={<Skeleton class="h-7 w-72" />}>
            <Segmented<Level>
              label="Initiative"
              value={settings().initiative}
              options={[
                { value: "off", label: "Off" },
                { value: "chat", label: "In chat only" },
                { value: "digest", label: "Daily digest" },
                { value: "active", label: "Active" },
              ]}
              onChange={(initiative) => void save({ initiative })}
            />
          </Show>
        </Row>
        <Row
          label="Memory capture"
          id="capture"
          description="Auto captures facts when you have saved a judge key. Off never captures."
        >
          <Show when={loaded()} fallback={<Skeleton class="h-7 w-24" />}>
            <Segmented<Capture>
              label="Memory capture"
              value={settings().capture}
              options={[
                { value: "auto", label: "Auto" },
                { value: "off", label: "Off" },
              ]}
              onChange={(capture) => void save({ capture })}
            />
          </Show>
        </Row>
      </Group>
    </div>
  )
}
