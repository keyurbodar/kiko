// Ported from t3code (MIT), apps/web/src/components/settings/ThemeImportDialog.tsx, in kiko's
// own controls: search Open VSX, or bring a t3code or VS Code theme file.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { FileIcon, PlusIcon } from "@kiko/ui/icons"
import { Show, createSignal, type JSX } from "solid-js"
import { buttonClass, muted, Notice } from "../settings/kit"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import {
  MAX_THEME_FILE_BYTES,
  humanizeThemeName,
  isVsCodeThemeFile,
  pairVsCodeThemes,
  parseAnyThemeFile,
  parseThemeFile,
  parseVsCodeThemeFile,
  resolveLabelCollisions,
  stripJsonComments,
  THEME_FILE_VERSION,
} from "./import"
import { customThemes, installThemes } from "./live"
import type { ThemeDefinition } from "./palette"
import { ThemeSearch } from "./theme-search"

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}

export function describeOversizedThemeFile(bytes: number): string | null {
  if (bytes <= MAX_THEME_FILE_BYTES) return null
  return `That file is ${formatBytes(bytes)}. Theme files are only a few KB, so it wasn't read (limit ${formatBytes(MAX_THEME_FILE_BYTES)}).`
}

/** Errors from the parser are sentences, shown as they come. */
const messageOf = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

/** A copy under the next free "name (n)". */
function copyOf(theme: ThemeDefinition): ThemeDefinition {
  for (let n = 1; n < 100; n += 1) {
    const suffix = ` (${n})`
    const candidate = parseThemeFile({
      version: THEME_FILE_VERSION,
      name: `${theme.label.slice(0, 48 - suffix.length)}${suffix}`,
      appearance: theme.appearance,
      colors: theme.colors,
      ...(theme.variants ? { variants: theme.variants } : {}),
    })
    if (!customThemes().some((t) => t.id === candidate.id)) return candidate
  }
  throw new Error(`Too many copies of "${theme.label}".`)
}

/** A dropped file named differently from its theme (dracula soft) keeps the file's name for its copy. */
function withName(theme: ThemeDefinition, file: string): ThemeDefinition {
  const name = humanizeThemeName(file.replace(/\.[^.]+$/, "")).slice(0, 48)
  if (!name || name.toLowerCase() === theme.label.toLowerCase()) return theme
  try {
    const renamed = parseThemeFile({
      version: THEME_FILE_VERSION,
      name,
      appearance: theme.appearance,
      colors: theme.colors,
      ...(theme.variants ? { variants: theme.variants } : {}),
    })
    return customThemes().some((t) => t.id === renamed.id) ? theme : renamed
  } catch {
    return theme
  }
}

export default function ThemeImportDialog(props: {
  onClose: () => void
  /** After an install. `updated` is true when it replaced themes already here. */
  onImported: (themes: ThemeDefinition[], updated: boolean) => void
}): JSX.Element {
  let fileInput: HTMLInputElement | undefined
  const [json, setJson] = createSignal("")
  const [fileName, setFileName] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [reading, setReading] = createSignal(false)
  const [dropTarget, setDropTarget] = createSignal(false)
  const [conflicts, setConflicts] = createSignal<ThemeDefinition[] | null>(null)

  const finish = (themes: ThemeDefinition[], updated: boolean) => {
    if (!installThemes(themes)) return setError("Themes couldn't be saved in this browser.")
    props.onImported(themes, updated)
    props.onClose()
  }

  /** Installs what is new; what is already here waits for an update-or-copy choice. */
  const offer = (themes: ThemeDefinition[]) => {
    if (themes.some((t) => customThemes().some((existing) => existing.id === t.id))) return setConflicts(themes)
    finish(themes, false)
  }

  const readFiles = async (files: File[]) => {
    if (!files.length) return
    setReading(true)
    setError(null)
    try {
      if (files.length === 1) {
        const file = files[0]!
        const oversized = describeOversizedThemeFile(file.size)
        if (oversized) return setError(oversized)
        setJson(await file.text())
        setFileName(file.name)
        return
      }
      // Several files import as a batch: VS Code families pair their light and dark variants.
      const failures: string[] = []
      const parsed: Array<{ theme: ThemeDefinition; sourceName: string }> = []
      for (const file of files) {
        if (describeOversizedThemeFile(file.size)) {
          failures.push(`${file.name}: Too large`)
          continue
        }
        try {
          const value: unknown = JSON.parse(stripJsonComments(await file.text()))
          parsed.push({ sourceName: file.name, theme: isVsCodeThemeFile(value) ? parseVsCodeThemeFile(value) : parseThemeFile(value) })
        } catch (cause) {
          failures.push(`${file.name}: ${messageOf(cause, "Not a theme file.")}`)
        }
      }
      if (failures.length) return setError(failures.join(" · "))
      offer(pairVsCodeThemes(resolveLabelCollisions(parsed)))
    } catch {
      setError("Couldn't read that file. Paste the JSON below instead.")
    } finally {
      setReading(false)
    }
  }

  const submit = () => {
    const oversized = describeOversizedThemeFile(json().length)
    if (oversized) return setError(oversized)
    try {
      offer([parseAnyThemeFile(json())])
    } catch (cause) {
      setError(messageOf(cause, "That theme file isn't valid."))
    }
  }

  const resolve = (mode: "update" | "copy") => {
    const themes = conflicts()
    if (!themes) return
    try {
      const next =
        mode === "update"
          ? themes
          : themes.map((t) => {
              const base = themes.length === 1 && fileName() ? withName(t, fileName()!) : t
              return customThemes().some((existing) => existing.id === base.id) ? copyOf(base) : base
            })
      setConflicts(null)
      finish(next, mode === "update")
    } catch (cause) {
      setError(messageOf(cause, "That theme couldn't be added."))
    }
  }

  return (
    <Dialog
      open
      onClose={props.onClose}
      title="Add a theme"
      size="md"
      data-component="theme-import-dialog"
      bodyClass="flex flex-col gap-5"
      footer={
        <Show
          when={!conflicts()}
          fallback={
            <>
              <button type="button" class={buttonClass("ghost")} onClick={() => setConflicts(null)}>
                Back
              </button>
              <button type="button" class={buttonClass()} onClick={() => resolve("copy")}>
                Keep both
              </button>
              <button type="button" class={buttonClass("primary")} onClick={() => resolve("update")}>
                Update existing
              </button>
            </>
          }
        >
          <button type="button" class={buttonClass("ghost")} onClick={() => props.onClose()}>
            Cancel
          </button>
          <button type="button" class={buttonClass("primary")} disabled={!json().trim() || reading()} data-action="add-theme-json" onClick={submit}>
            <HugeIcon icon={PlusIcon} size={14} />
            Add theme
          </button>
        </Show>
      }
    >
      <ThemeSearch
        onInstalled={(themes, updated) => {
          props.onImported(themes, updated)
          props.onClose()
        }}
      />
      <div class="flex items-center gap-3" aria-hidden="true">
        <div class="h-px flex-1 bg-[var(--hairline)]" />
        <span class={cn("text-[12px]", muted)}>Or import a file</span>
        <div class="h-px flex-1 bg-[var(--hairline)]" />
      </div>
      <Show
        when={!conflicts()}
        fallback={
          <p class="text-[13px] text-text">
            Already installed: <span class={muted}>{conflicts()!.map((t) => t.label).join(", ")}</span>
          </p>
        }
      >
        {/* The whole import area takes a dropped file; it washes with the accent while one is over it. */}
        <div
          data-slot="theme-drop-zone"
          class="-m-2 flex flex-col gap-4 rounded-xl p-2"
          classList={{ "bg-[var(--accent-wash)]": dropTarget() }}
          onDragEnter={(event) => {
            event.preventDefault()
            setDropTarget(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDropTarget(true)
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDropTarget(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDropTarget(false)
            void readFiles([...(event.dataTransfer?.files ?? [])])
          }}
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-text">Theme file</p>
              <p class={cn("truncate text-[12px]", muted)}>{fileName() ?? "Drop t3code or VS Code .json files"}</p>
            </div>
            <button type="button" class={buttonClass()} disabled={reading()} onClick={() => fileInput?.click()}>
              <HugeIcon icon={FileIcon} size={14} />
              {reading() ? "Reading…" : "Choose files"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.jsonc,application/json"
              multiple
              class="sr-only"
              data-slot="theme-file-input"
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])]
                event.currentTarget.value = ""
                void readFiles(files)
              }}
            />
          </div>
          <label class="flex flex-col gap-2">
            <span class="text-[13px] font-medium text-text">Theme JSON</span>
            <textarea
              aria-label="Theme JSON"
              spellcheck={false}
              class="min-h-44 w-full resize-y rounded-lg bg-input p-3 font-mono text-xs leading-5 text-text outline-none placeholder:text-faint"
              placeholder={'{\n  "version": 1,\n  "name": "Aurora",\n  "appearance": "light",\n  "colors": { ... }\n}'}
              value={json()}
              onInput={(event) => setJson(event.currentTarget.value)}
              data-component="theme-json"
            />
          </label>
        </div>
      </Show>
      <Show when={error()}>
        <div aria-live="polite" data-slot="theme-import-error">
          <Notice>{error()!}</Notice>
        </div>
      </Show>
    </Dialog>
  )
}
