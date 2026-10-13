import type { UserSettings } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal, onMount } from "solid-js"
import { Group, Row, Segmented } from "./kit"

/*
 * Initiative (architecture section 26): how much Kiko may speak up unasked, and whether it writes down
 * facts it hears. Each choice applies at once and is put back, with a toast, if the server refuses it.
 */

type Settings = UserSettings
export type Level = Settings["initiative"]
export type Capture = Settings["capture"]

const LEVELS: readonly Level[] = ["off", "chat", "digest", "active"]
const CAPTURES: readonly Capture[] = ["auto", "off"]
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

// The newest save of each field. A failed save puts a field back only if no later save touched it.
const latest: Partial<Record<keyof Settings, number>> = {}
let counter = 0

async function save(patch: Partial<Settings>): Promise<void> {
  const before = settings()
  const id = ++counter
  for (const k of Object.keys(patch)) latest[k as keyof Settings] = id
  setSettings({ ...before, ...patch })
  const ok = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })
    .then((r) => r.ok)
    .catch(() => false)
  if (!ok) {
    const mine = Object.keys(patch).filter((k) => latest[k as keyof Settings] === id)
    if (mine.length) setSettings((now) => ({ ...now, ...Object.fromEntries(mine.map((k) => [k, before[k as keyof Settings]])) }))
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
    <div class="flex flex-col gap-8" data-component="initiative-settings">
        <Group title="Speaking up">
          <Row label="Initiative" id="initiative" description="Off: no initiative and no background judge cost. In chat only: brings things up only inside replies. Daily digest: at most one message a day. Active: a few, learned from how you respond.">
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
          <Row label="Memory capture" id="capture" description="Auto captures facts when you have saved a judge key. Off never captures.">
            <Segmented<Capture>
              label="Memory capture"
              value={settings().capture}
              options={[
                { value: "auto", label: "Auto" },
                { value: "off", label: "Off" },
              ]}
              onChange={(capture) => void save({ capture })}
            />
          </Row>
        </Group>
    </div>
  )
}
