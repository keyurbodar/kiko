import { createHotkeyRecorder, detectPlatform, formatForDisplay, type Hotkey } from "@tanstack/solid-hotkeys"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createMemo, createSignal, For, Show } from "solid-js"
import { bindKey, bindings, resetAllKeys, resetKey } from "../commands/bindings"
import { commands, GROUP_LABEL, keysOf, shortcutOf, type Command, type CommandGroup } from "../commands/registry"
import { cn } from "../lib/cn"
import { browserKey, refusal, sameKey } from "./browser-keys"
import { Button, Empty, fieldClass, Group, Hint, muted, Row } from "./kit"

const platform = detectPlatform()
const ORDER = Object.keys(GROUP_LABEL) as CommandGroup[]

const show = (key: string) => formatForDisplay(key, { platform })

function Keys(props: { keys: string }) {
  return (
    <span class="inline-flex items-center gap-1">
      <For each={formatForDisplay(props.keys, { platform, parts: true })}>
        {(part) => (
          <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-active px-1 font-sans text-hint font-medium text-fg2">
            {part}
          </kbd>
        )}
      </For>
    </span>
  )
}

function KeyRow(props: { command: Command }) {
  const [problem, setProblem] = createSignal<string>()
  const key = () => shortcutOf(props.command)
  const record = (hotkey: Hotkey) => {
    setProblem(undefined)
    const id = props.command.id
    const owner = commands().find((c) => c.id !== id && keysOf(c).some((k) => sameKey(k, hotkey, platform)))
    if (owner) {
      bindKey(owner.id, null)
      showToastV2({ title: `${show(hotkey)} moved from ${owner.title}` })
    }
    if (props.command.shortcut && sameKey(props.command.shortcut, hotkey, platform)) resetKey(id)
    else bindKey(id, hotkey)
  }
  const recorder = createHotkeyRecorder(() => ({
    recordBy: "key",
    platform,
    ignoreInputs: false,
    validate: (hotkey) => refusal(props.command, hotkey, platform) ?? true,
    onReject: (rejection) => setProblem(rejection.message),
    onRecord: record,
    onCancel: () => setProblem(undefined),
    onClear: () => {
      setProblem(undefined)
      if (props.command.shortcut) bindKey(props.command.id, null)
      else resetKey(props.command.id)
    },
  }))
  const toggle = () => {
    if (recorder.isRecording()) {
      recorder.cancelRecording()
      return
    }
    setProblem(undefined)
    recorder.startRecording()
  }
  const note = () => {
    if (problem()) return <span class="text-[var(--bad)]">{problem()}</span>
    const k = key()
    const claimed = k && browserKey(k, platform)
    if (claimed) return `Kiko takes this from the browser, where it means ${claimed.action}.`
    return undefined
  }
  const custom = () => props.command.id in bindings()
  return (
    <Row
      label={props.command.title}
      id={props.command.id}
      description={note()}
      onReset={custom() ? () => resetKey(props.command.id) : undefined}
      data-custom={custom() ? "" : undefined}
    >
      <button
        type="button"
        class={cn(
          "inline-flex h-7 min-w-24 cursor-pointer items-center justify-end rounded-control px-2 text-label outline-none hover:bg-[var(--hover)]",
          recorder.isRecording() && "bg-[var(--hover)] ring-2 ring-[var(--fg3)]",
        )}
        aria-label={
          recorder.isRecording()
            ? `Press the new shortcut for ${props.command.title}`
            : `Change the shortcut for ${props.command.title}`
        }
        data-action="record-shortcut"
        data-recording={recorder.isRecording() ? "" : undefined}
        onClick={toggle}
        onBlur={() => recorder.isRecording() && recorder.cancelRecording()}
      >
        <Show when={!recorder.isRecording()} fallback={<span class="text-fg">Press keys…</span>}>
          <Show when={key()} fallback={<span class={muted}>None</span>}>
            {(k) => <Keys keys={k()} />}
          </Show>
        </Show>
      </button>
    </Row>
  )
}

export default function KeyboardPage() {
  const [query, setQuery] = createSignal("")
  const groups = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (c: Command) => {
      const k = shortcutOf(c)
      const text = `${c.title} ${GROUP_LABEL[c.group]} ${k ? `${k} ${show(k)}` : ""}`.toLowerCase()
      return words.every((w) => text.includes(w))
    }
    const listed = commands().filter(matches)
    return ORDER.map((group) => ({ group, list: listed.filter((c) => c.group === group) })).filter(
      (g) => g.list.length > 0,
    )
  })
  const changed = () => Object.keys(bindings()).length > 0
  return (
    <div class="flex flex-col gap-8" data-component="keyboard-settings">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <input
            type="search"
            class={cn(fieldClass, "min-w-0 flex-1")}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !query()) return
              e.preventDefault()
              e.stopPropagation()
              setQuery("")
            }}
          />
          <Show when={changed()}>
            <Button variant="secondary" data-action="reset-all-shortcuts" onClick={resetAllKeys}>
              Reset all
            </Button>
          </Show>
        </div>
        <Hint>
          Click a shortcut, then press the new keys. Escape cancels and Backspace removes the key. Shortcuts are saved
          in this browser.
        </Hint>
      </div>
      <For each={groups()} fallback={<Empty>No matching shortcuts</Empty>}>
        {(g) => (
          <Group title={GROUP_LABEL[g.group]} data-shortcut-group={g.group}>
            <For each={g.list}>{(command) => <KeyRow command={command} />}</For>
          </Group>
        )}
      </For>
    </div>
  )
}
