import { SearchField } from "@kiko/ui/v2/search-field"
import { createHotkeyRecorder, detectPlatform, formatForDisplay, type Hotkey } from "@tanstack/solid-hotkeys"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ResetIcon } from "@kiko/ui/icons"
import { createMemo, createSignal, For, Show } from "solid-js"
import { bindKey, bindings, resetAllKeys, resetKey } from "../commands/bindings"
import { commands, GROUP_LABEL, keysOf, shortcutOf, type Command, type CommandGroup } from "../commands/registry"
import { cn } from "../lib/cn"
import { browserKey, refusal, sameKey } from "./browser-keys"
import { Button, Empty, Group, IconButton } from "./kit"

const platform = detectPlatform()
const ORDER = Object.keys(GROUP_LABEL) as CommandGroup[]

const show = (key: string) => formatForDisplay(key, { platform })

const SHINE = { "--run-text": "var(--fg3)", "--visible-animation-state": "running" }

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

function Keys(props: { keys: string; ref?: (el: HTMLSpanElement) => void }) {
  return (
    <span ref={props.ref} class="inline-flex items-center gap-1" data-field="keys">
      <For each={formatForDisplay(props.keys, { platform, parts: true })}>
        {(part) => (
          <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded-tail bg-[var(--fill-field)] px-1 font-sans text-hint font-medium text-[var(--text-200)]">
            {part}
          </kbd>
        )}
      </For>
    </span>
  )
}

type Conflict = { hotkey: Hotkey; owner: Command }

function KeyRow(props: { command: Command }) {
  const [problem, setProblem] = createSignal<string>()
  const [conflict, setConflict] = createSignal<Conflict>()
  let row!: HTMLDivElement
  let keys: HTMLSpanElement | undefined
  const key = () => shortcutOf(props.command)
  const saved = () =>
    requestAnimationFrame(() => {
      if (calm()) return
      row.animate([{ backgroundColor: "var(--hover)" }, { backgroundColor: "transparent" }], {
        duration: 400,
        easing: "cubic-bezier(.2,.8,.2,1)",
      })
      keys?.animate([{ transform: "scale(0.9)" }, { transform: "scale(1)" }], {
        duration: 250,
        easing: "cubic-bezier(.34,1.56,.64,1)",
      })
    })
  const bind = (hotkey: Hotkey) => {
    const id = props.command.id
    if (props.command.shortcut && sameKey(props.command.shortcut, hotkey, platform)) resetKey(id)
    else bindKey(id, hotkey)
    saved()
  }
  const record = (hotkey: Hotkey) => {
    setProblem(undefined)
    setConflict(undefined)
    const id = props.command.id
    const owner = commands().find((c) => c.id !== id && keysOf(c).some((k) => sameKey(k, hotkey, platform)))
    if (owner) return void setConflict({ hotkey, owner })
    bind(hotkey)
  }
  const useAnyway = () => {
    const taken = conflict()
    if (!taken) return
    setConflict(undefined)
    bindKey(taken.owner.id, null)
    bind(taken.hotkey)
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
      setConflict(undefined)
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
    setConflict(undefined)
    recorder.startRecording()
  }
  const claimed = () => {
    const k = key()
    const taken = k && browserKey(k, platform)
    return taken ? `Kiko takes this from the browser, where it means ${taken.action}.` : undefined
  }
  const custom = () => props.command.id in bindings()
  return (
    <div
      ref={row}
      class="group/key flex flex-col rounded-row"
      data-setting={props.command.id}
      data-custom={custom() ? "" : undefined}
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-6 rounded-row px-3 py-2 text-left outline-none transition-[background-color,transform] duration-(--dur-hover) ease-[var(--ease-out)] hover:bg-[var(--fill-hover)] focus-visible:shadow-[var(--focus-ring)] active:scale-[0.99]"
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
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-row leading-5 font-medium text-fg">{props.command.title}</span>
            <Show
              when={recorder.isRecording()}
              fallback={
                <Show when={problem() ?? claimed()}>
                  {(text) => (
                    <span
                      class={cn("type-label", problem() ? "text-[var(--danger)]" : "text-[var(--text-300)]")}
                      data-field="shortcut-note"
                    >
                      {text()}
                    </span>
                  )}
                </Show>
              }
            >
              <span class="type-hint text-[var(--text-400)]">Esc to cancel, Backspace to remove</span>
            </Show>
          </span>
          <span
            class={cn(
              "inline-flex h-7 min-w-24 shrink-0 items-center justify-end rounded-control px-2 transition-colors duration-(--dur-hover)",
              recorder.isRecording() && "bg-[var(--active)]",
            )}
          >
            <Show
              when={!recorder.isRecording()}
              fallback={
                <span class="motion-shine type-label text-[var(--text-300)]" style={SHINE}>
                  Press keys
                </span>
              }
            >
              <Show
                when={key()}
                fallback={
                  <span class="type-label text-[var(--text-300)] opacity-0 transition-opacity duration-(--dur-hover) group-hover/key:opacity-100 group-focus-within/key:opacity-100">
                    Add shortcut
                  </span>
                }
              >
                {(k) => <Keys keys={k()} ref={(el) => (keys = el)} />}
              </Show>
            </Show>
          </span>
        </button>
        <Show when={custom()}>
          <IconButton
            label={`Reset ${props.command.title.toLowerCase()} to default`}
            data-action="reset-setting"
            onClick={() => {
              resetKey(props.command.id)
              saved()
            }}
          >
            <RemixIcon icon={ResetIcon} size={16} />
          </IconButton>
        </Show>
      </div>
      <Show when={conflict()}>
        {(taken) => (
          <p
            class="flex flex-wrap items-center gap-x-2 px-3 pb-2 type-label text-[var(--danger)]"
            role="alert"
            data-field="shortcut-conflict"
          >
            {show(taken().hotkey)} already opens {taken().owner.title}.
            <button
              type="button"
              class="link-grow cursor-pointer text-fg"
              data-action="use-shortcut-anyway"
              onClick={useAnyway}
            >
              Use anyway
            </button>
          </p>
        )}
      </Show>
    </div>
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
    <div class="flex flex-col gap-[18px]" data-component="keyboard-settings">
      <div class="flex items-center gap-2">
        <SearchField
          wrapClass="min-w-0 flex-1"
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          value={query()}
          onValue={setQuery}
        />
        <Show when={changed()}>
          <Button variant="secondary" data-action="reset-all-shortcuts" onClick={resetAllKeys}>
            Reset all
          </Button>
        </Show>
      </div>
      <For each={groups()} fallback={<Empty>No matching shortcuts</Empty>}>
        {(g) => (
          <Group title={GROUP_LABEL[g.group]} data-shortcut-group={g.group}>
            <div class="flex flex-col gap-0.5 p-1.5">
              <For each={g.list}>{(command) => <KeyRow command={command} />}</For>
            </div>
          </Group>
        )}
      </For>
    </div>
  )
}
