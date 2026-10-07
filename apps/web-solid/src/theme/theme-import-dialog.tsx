// Ported from t3code (MIT), apps/web/src/components/settings/ThemeImportDialog.tsx, in kiko's
// own controls: search Open VSX, or bring a t3code or VS Code theme file.
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { FileIcon, PlusIcon } from "@kiko/ui/icons"
import { Show, createSignal, type JSX } from "solid-js"
import { button } from "./controls"
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
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} mb`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kb`
  return `${bytes} bytes`
}

export function describeOversizedThemeFile(bytes: number): string | null {
  if (bytes <= MAX_THEME_FILE_BYTES) return null
  return `that file is ${formatBytes(bytes)}. theme files are only a few kb, so it wasn't read (limit ${formatBytes(MAX_THEME_FILE_BYTES)})`
}

/** Errors from the parser are sentences; the interface voice is lowercase. */
const lower = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback).toLowerCase()

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
  throw new Error(`too many copies of "${theme.label}"`)
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
    if (!installThemes(themes)) return setError("themes couldn't be saved in this browser")
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
          failures.push(`${file.name}: too large`)
          continue
        }
        try {
          const value: unknown = JSON.parse(stripJsonComments(await file.text()))
          parsed.push({ sourceName: file.name, theme: isVsCodeThemeFile(value) ? parseVsCodeThemeFile(value) : parseThemeFile(value) })
        } catch (cause) {
          failures.push(`${file.name}: ${lower(cause, "not a theme file")}`)
        }
      }
      if (failures.length) return setError(failures.join(" · "))
      offer(pairVsCodeThemes(resolveLabelCollisions(parsed)))
    } catch {
      setError("couldn't read that file. paste the json below instead")
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
      setError(lower(cause, "that theme file isn't valid"))
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
      setError(lower(cause, "that theme couldn't be added"))
    }
  }

  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="flex max-h-[90vh] w-[min(720px,calc(100vw-32px))] flex-col gap-5 overflow-y-auto rounded-[calc(20px*var(--brm))] bg-menu p-5 text-text shadow-popover"
          data-component="theme-import-dialog"
        >
          <ModalV2.Title class="text-base font-medium text-text">add a theme</ModalV2.Title>
          <ThemeSearch
            onInstalled={(themes, updated) => {
              props.onImported(themes, updated)
              props.onClose()
            }}
          />
          <div class="flex items-center gap-3" aria-hidden="true">
            <div class="h-px flex-1 bg-[var(--hairline)]" />
            <span class="text-[11px] text-faint">or import a file</span>
            <div class="h-px flex-1 bg-[var(--hairline)]" />
          </div>
          <Show
            when={!conflicts()}
            fallback={
              <div class="flex flex-col gap-3">
                <div class="rounded-xl bg-[var(--card)] p-3">
                  <p class="text-sm font-medium">already installed</p>
                  <p class="mt-1 text-xs text-muted">{conflicts()!.map((t) => t.label.toLowerCase()).join(", ")}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class={button} onClick={() => resolve("update")}>
                    update existing
                  </button>
                  <button type="button" class={button} onClick={() => resolve("copy")}>
                    keep both
                  </button>
                  <button type="button" class={button} onClick={() => setConflicts(null)}>
                    back
                  </button>
                </div>
              </div>
            }
          >
            <div class="flex flex-col gap-4">
              <div
                data-slot="theme-drop-zone"
                class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3"
                classList={{ "bg-[var(--accent-wash)]": dropTarget(), "bg-[var(--card)]": !dropTarget() }}
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
                <div class="min-w-0">
                  <p class="text-sm font-medium">theme file</p>
                  <p class="truncate text-xs text-muted">{fileName() ?? "drop t3code or vs code .json files"}</p>
                </div>
                <button type="button" class={button} disabled={reading()} onClick={() => fileInput?.click()}>
                  <HugeIcon icon={FileIcon} size={14} />
                  {reading() ? "reading…" : "choose files"}
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
                <span class="text-sm font-medium">theme json</span>
                <textarea
                  aria-label="theme json"
                  spellcheck={false}
                  class="min-h-44 w-full resize-y rounded-xl bg-input p-3 font-mono text-xs leading-5 text-text outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  placeholder={'{\n  "version": 1,\n  "name": "aurora",\n  "appearance": "light",\n  "colors": { ... }\n}'}
                  value={json()}
                  onInput={(event) => setJson(event.currentTarget.value)}
                  data-component="theme-json"
                />
              </label>
              <div class="flex flex-wrap justify-end gap-2">
                <button type="button" class={button} onClick={() => props.onClose()}>
                  cancel
                </button>
                <button
                  type="button"
                  class={`${button} bg-[var(--accent-fill)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]`}
                  disabled={!json().trim() || reading()}
                  data-action="add-theme-json"
                  onClick={submit}
                >
                  <HugeIcon icon={PlusIcon} size={14} />
                  add theme
                </button>
              </div>
            </div>
          </Show>
          <Show when={error()}>
            <p class="rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-xs text-[var(--danger)]" role="alert" aria-live="polite" data-slot="theme-import-error">
              {error()}
            </p>
          </Show>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
