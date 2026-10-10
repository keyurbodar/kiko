import { showToastV2 } from "@yuki/ui/v2/toast-v2"
import { createSignal, onMount } from "solid-js"
import { Group, Page, Row, Segmented } from "./kit"

/*
 * Initiative (architecture section 26): how much Yuki may speak up unasked, and whether it writes down
 * facts it hears. Each choice applies at once and is put back, with a toast, if the server refuses it.
 */

export type Level = "off" | "chat" | "digest" | "active"
export type Capture = "auto" | "always" | "off"
type Settings = { initiative: Level; capture: Capture }

const LEVELS: readonly Level[] = ["off", "chat", "digest", "active"]
const CAPTURES: readonly Capture[] = ["auto", "always", "off"]
const DEFAULTS: Settings = { initiative: "digest", capture: "auto" }

const [settings, setSettings] = createSignal<Settings>(DEFAULTS)

/** A server answer reduced to values the page knows. Anything else keeps the default. */
export function readSettings(value: unknown): Settings {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    initiative: LEVELS.includes(v.initiative as Level) ? (v.initiative as Level) : DEFAULTS.initiative,
    capture: CAPTURES.includes(v.capture as Capture) ? (v.capture as Capture) : DEFAULTS.capture,
  }
}

async function save(patch: Partial<Settings>): Promise<void> {
  const before = settings()
  setSettings({ ...before, ...patch })
  const ok = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
    .then((r) => r.ok)
    .catch(() => false)
  if (!ok) {
    setSettings((now) => ({ ...now, ...Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Settings]])) }))
    showToastV2({ title: "Could not save that setting", variant: "error" })
  }
}

export default function InitiativePage() {
  onMount(() => {
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v && setSettings(readSettings(v)))
      .catch(() => {})
  })
  return (
    <Page title="Initiative" description="How much Yuki speaks up without being asked.">
      <div class="flex flex-col gap-8" data-component="initiative-settings">
        <Group title="Speaking up">
          <Row label="Initiative" id="initiative" description="Off stays quiet. In chat only reminds an agent while you talk. Daily digest adds at most one nudge a day. Active nudges when it matters.">
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
          </Row>
        </Group>
        <Group title="Memory">
          <Row label="Memory capture" id="capture" description="Auto captures facts when you saved a judge key. Always falls back to the memory model. Off never captures.">
            <Segmented<Capture>
              label="Memory capture"
              value={settings().capture}
              options={[
                { value: "auto", label: "Auto" },
                { value: "always", label: "Always" },
                { value: "off", label: "Off" },
              ]}
              onChange={(capture) => void save({ capture })}
            />
          </Row>
        </Group>
      </div>
    </Page>
  )
}
