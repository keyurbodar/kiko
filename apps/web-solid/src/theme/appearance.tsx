import { For, Show, createSignal } from "solid-js"
import { compileTheme } from "./apply"
import { look, saveLook } from "./live"
import { LookPicker } from "./look-picker"
import { formatTheme, MAX_THEME_CHARS } from "./schema"

/*
 * Settings, appearance. The same picker as the first-run screen, then a way to bring your
 * own theme as JSON: paste it or import a file. A theme that fails validation is never
 * applied, and its errors say which key is wrong. The format is in `docs/theming.md`.
 */

const button =
  "h-9 rounded-[10px] bg-[var(--btn-bg)] px-3.5 text-xs text-text outline-none hover:bg-[var(--btn-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"

const STARTER = formatTheme({ version: 1, name: "my theme", extends: "plum", colors: { hue: 200, userHue: 200, chroma: 1.2 } })

export default function Appearance() {
  const [draft, setDraft] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<string[]>([])
  const custom = () => {
    const t = look().theme
    return "custom" in t ? t.custom : null
  }

  const apply = (text: string) => {
    const c = compileTheme(text)
    if (!c.ok) return setErrors(c.errors)
    setErrors([])
    setDraft(null)
    saveLook({ ...look(), theme: { custom: c.theme } })
  }
  const importFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    if (file.size > MAX_THEME_CHARS) return setErrors([`json: the file is larger than ${MAX_THEME_CHARS / 1024} KB`])
    apply(await file.text())
  }
  const exportText = () => formatTheme(custom() ?? { version: 1, name: "my theme", extends: "plum" })

  return (
    <div class="flex flex-col gap-6" data-component="appearance">
      <section class="flex flex-col gap-3 rounded-2xl bg-[var(--bg-subtle)] p-4">
        <LookPicker look={look()} onChange={saveLook} />
      </section>

      <section class="flex flex-col gap-3" data-component="custom-theme">
        <div class="flex flex-col gap-1">
          <h3 class="text-sm text-text">your own theme</h3>
          <p class="text-xs text-muted">
            bring a theme as json. it can change every color, radius, spacing and type size, with a separate set for light mode.
          </p>
        </div>
        <Show when={custom()}>
          {(t) => (
            <div class="flex items-center gap-3 rounded-xl bg-[var(--bg-subtle)] px-3 py-2 text-sm" data-component="custom-active">
              <span class="size-2 rounded-full bg-[var(--accent)]" />
              <span class="min-w-0 flex-1 truncate">{t().name}</span>
              <span class="text-xs text-muted">in use</span>
            </div>
          )}
        </Show>
        <Show when={draft() !== null}>
          <textarea
            class="min-h-48 w-full resize-y rounded-xl bg-input p-3 font-mono text-xs leading-relaxed text-text outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="theme json"
            spellcheck={false}
            value={draft()!}
            onInput={(e) => setDraft(e.currentTarget.value)}
            data-component="theme-json"
          />
        </Show>
        <Show when={errors().length}>
          <ul class="flex flex-col gap-1 text-xs text-[var(--danger)]" role="alert" data-component="theme-errors">
            <For each={errors()}>{(e) => <li>{e}</li>}</For>
          </ul>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Show
            when={draft() !== null}
            fallback={
              <button type="button" class={button} data-action="write-theme" onClick={() => setDraft(custom() ? exportText() : STARTER)}>
                {custom() ? "edit json" : "write json"}
              </button>
            }
          >
            <button type="button" class={button} data-action="apply-theme" onClick={() => apply(draft()!)}>
              use this theme
            </button>
            <button type="button" class={button} onClick={() => (setDraft(null), setErrors([]))}>
              cancel
            </button>
          </Show>
          <label class={`${button} inline-flex cursor-default items-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)]`}>
            import file
            <input type="file" accept=".json,application/json" class="sr-only" data-action="import-theme" onChange={(e) => void importFile(e)} />
          </label>
          <button type="button" class={button} data-action="copy-theme" onClick={() => void navigator.clipboard?.writeText(exportText()).catch(() => {})}>
            copy json
          </button>
        </div>
      </section>
    </div>
  )
}
