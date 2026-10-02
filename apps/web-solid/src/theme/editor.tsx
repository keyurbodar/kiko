import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { endPreview, compileTheme, preview } from "./apply"
import { MAX_THEME_CHARS, formatTheme } from "./schema"
import { PRESETS } from "./presets"
import { savedTheme, saveTheme } from "./live"
import type { Mounted } from "./editor-cm"

/*
 * Settings, appearance. Presets, a JSON editor with its errors under it, paste, import,
 * export, and reset. A valid draft previews live and goes back on cancel or when the page
 * closes. An invalid draft is never applied. CodeMirror loads on first use, and a plain
 * textarea holds the text until it arrives.
 */

const STARTER = formatTheme({ version: 1, name: "my theme", extends: "kat-dark" })
const PRESET_LABELS: [string, string][] = [
  ["kat-dark", "kat dark"],
  ["kat-light", "kat light"],
  ["ink", "ink"],
  ["paper", "paper"],
]

/** A preset as text to edit. The built-ins are named in `extends` by what they extend. */
function presetText(id: string): string {
  const p = PRESETS[id]!
  if (id === "kat-dark" || id === "kat-light") return formatTheme({ version: 1, name: p.name, extends: id })
  return formatTheme(p)
}

function JsonEditor(props: { value: string; onChange: (value: string) => void }) {
  let host!: HTMLDivElement
  const [ready, setReady] = createSignal(false)
  let mounted: Mounted | undefined
  let gone = false

  onMount(() => {
    void import("./editor-cm").then(({ mountJsonEditor }) => {
      if (gone) return
      mounted = mountJsonEditor(host, props.value, props.onChange)
      setReady(true)
    })
  })
  onCleanup(() => {
    gone = true
    mounted?.destroy()
  })
  createEffect(() => mounted?.set(props.value))

  return (
    <div class="min-h-48 flex-1 overflow-auto rounded-lg bg-input p-3" data-component="theme-editor">
      <textarea
        class="h-full min-h-48 w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-text outline-none"
        classList={{ hidden: ready() }}
        aria-label="theme json"
        spellcheck={false}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <div ref={host} classList={{ hidden: !ready() }} class="h-full min-h-48" />
    </div>
  )
}

const button = "h-8 rounded-[10px] bg-[var(--tab-bg)] px-3 text-xs text-[var(--tab-text-active)] hover:bg-[var(--tab-bg-active)] disabled:opacity-50"

export default function Appearance() {
  const [draft, setDraft] = createSignal(savedTheme() ?? STARTER)
  const [notice, setNotice] = createSignal<string | null>(null)
  const baseline = () => savedTheme() ?? STARTER
  const dirty = () => draft().trim() !== baseline().trim()
  const compiled = createMemo(() => compileTheme(draft()))
  const errors = () => {
    const c = compiled()
    return c.ok ? [] : c.errors
  }
  const notes = () => {
    const c = compiled()
    return c.ok ? c.notes : []
  }

  // A valid draft shows live. An invalid one shows the saved theme.
  createEffect(() => {
    const c = compiled()
    if (c.ok) preview(c.resolved)
    else endPreview()
  })
  onCleanup(endPreview)

  // A change from another device replaces a draft the person has not touched.
  createEffect(
    on(savedTheme, (next, prev) => {
      if (draft().trim() === (prev ?? STARTER).trim()) setDraft(next ?? STARTER)
    }, { defer: true }),
  )

  function edit(text: string) {
    setNotice(null)
    setDraft(text)
  }

  function save() {
    const c = compiled()
    if (!c.ok) return
    saveTheme(draft().trim())
    setNotice("saved. every device you are signed in on gets it.")
  }

  function reset() {
    saveTheme(null)
    setDraft(STARTER)
    setNotice("back to kat dark")
  }

  async function paste() {
    try {
      edit(await navigator.clipboard.readText())
    } catch {
      setNotice("the browser did not allow reading the clipboard. paste into the editor instead.")
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    if (file.size > MAX_THEME_CHARS) {
      setNotice(`that file is ${Math.ceil(file.size / 1024)} kb. a theme is a few kb, so it was not read.`)
      return
    }
    edit(await file.text())
  }

  function exportFile() {
    const url = URL.createObjectURL(new Blob([draft()], { type: "application/json" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "kiko-theme.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3" data-component="appearance">
      <p class="text-xs text-weak">
        pick a preset or write a theme in json. radius, spacing, type, size, and every color are in reach. the preview is live until you save.
      </p>
      <div class="flex flex-wrap gap-2" data-component="theme-presets">
        <For each={PRESET_LABELS}>
          {([id, label]) => (
            <button type="button" class={button} data-preset={id} onClick={() => edit(presetText(id))}>
              {label}
            </button>
          )}
        </For>
      </div>
      <JsonEditor value={draft()} onChange={edit} />
      <Show when={errors().length}>
        <ul class="flex flex-col gap-1 text-xs text-[var(--accent)]" role="alert" data-component="theme-errors">
          <For each={errors()}>{(e) => <li>{e}</li>}</For>
        </ul>
      </Show>
      <Show when={!errors().length && notes().length}>
        <ul class="flex flex-col gap-1 text-xs text-weak" data-component="theme-notes">
          <For each={notes()}>{(n) => <li>{n}</li>}</For>
        </ul>
      </Show>
      <Show when={notice()}>
        <p class="text-xs text-muted" data-component="theme-notice">{notice()}</p>
      </Show>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="h-8 rounded-[10px] bg-[var(--accent-fill)] px-3 text-xs text-[var(--on-accent)] disabled:opacity-50"
          data-action="save-theme"
          disabled={!dirty() || errors().length > 0}
          onClick={save}
        >
          save
        </button>
        <button type="button" class={button} data-action="cancel-theme" disabled={!dirty()} onClick={() => edit(baseline())}>
          cancel
        </button>
        <button type="button" class={button} data-action="paste-theme" onClick={() => void paste()}>
          paste
        </button>
        <label class={`${button} inline-flex cursor-default items-center`}>
          import file
          <input type="file" accept=".json,application/json" class="hidden" data-action="import-theme" onChange={(e) => void importFile(e)} />
        </label>
        <button type="button" class={button} data-action="export-theme" onClick={exportFile}>
          export
        </button>
        <button type="button" class={button} data-action="reset-theme" onClick={reset}>
          reset to kat
        </button>
      </div>
    </div>
  )
}
