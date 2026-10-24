import { FileTextIcon, FolderOpenIcon, type Glyph, MemoryIcon, RepeatIcon, TasksIcon, WorkerIcon } from "@kiko/ui/icons"
import { fileName } from "@kiko/protocol"
import { type Component, lazy } from "solid-js"
import { roomMembers } from "../info/sections"

type Views = typeof import("./panel-views")
export const loadPanelViews = (): Promise<Views> => import("./panel-views")
const view = <N extends keyof Views>(name: N) => lazy(async () => ({ default: (await loadPanelViews())[name] }))

type PanelProps<F> = { chatId: string; surface: F; close: () => void }

export type PanelEntry<F extends object = object> = {
  label: string | ((surface: F) => string)
  icon: Glyph
  launcher?: { key: string; group?: true }
  selfScrolling?: true
  instance?: { id: (surface: F) => string; parse: (raw: Record<string, unknown>) => F | null }
  component: Component<PanelProps<F>>
}

const panel = <F extends object = object>(entry: PanelEntry<F>): PanelEntry<F> => entry

const text = (raw: Record<string, unknown>, key: string): string | null =>
  typeof raw[key] === "string" ? (raw[key] as string) : null

export const PANELS = {
  files: panel({
    label: "Files",
    icon: FolderOpenIcon,
    launcher: { key: "F" },
    selfScrolling: true,
    component: view("FilesView"),
  }),
  memory: panel({
    label: "Memory",
    icon: MemoryIcon,
    launcher: { key: "M" },
    selfScrolling: true,
    component: view("MemoryView"),
  }),
  routines: panel({ label: "Routines", icon: RepeatIcon, launcher: { key: "R" }, component: view("RoutinesView") }),
  tasks: panel({
    label: "Tasks",
    icon: TasksIcon,
    launcher: { key: "T", group: true },
    component: view("TasksPanelView"),
  }),
  file: panel<{ path: string }>({
    label: (surface) => fileName(surface.path),
    icon: FileTextIcon,
    selfScrolling: true,
    instance: {
      id: (surface) => `file:${surface.path}`,
      parse: (raw) => {
        const path = text(raw, "path")
        return path === null ? null : { path }
      },
    },
    component: view("FileView"),
  }),
  agent: panel<{ slug: string }>({
    label: (surface) => roomMembers().find((m) => m.slug === surface.slug)?.name ?? surface.slug,
    icon: WorkerIcon,
    instance: {
      id: (surface) => `agent:${surface.slug}`,
      parse: (raw) => {
        const slug = text(raw, "slug")
        return slug === null ? null : { slug }
      },
    },
    component: view("AgentView"),
  }),
}

type Panels = typeof PANELS
export type PanelKind = keyof Panels
type Fields<K extends PanelKind> = Panels[K] extends PanelEntry<infer F> ? F : never
export type FixedKind = { [K in PanelKind]: Panels[K] extends { instance: object } ? never : K }[PanelKind]
export type Surface = { [K in PanelKind]: { id: string; kind: K } & Fields<K> }[PanelKind]

export const panelOf = <K extends PanelKind>(kind: K): PanelEntry<Fields<K>> =>
  PANELS[kind] as unknown as PanelEntry<Fields<K>>

export function panelLabel(surface: Surface): string {
  const label = panelOf(surface.kind).label
  return typeof label === "string" ? label : (label as (s: Surface) => string)(surface)
}

export type LauncherItem = { kind: FixedKind; label: string; key: string }

export function launcherEntries(group: boolean): LauncherItem[] {
  return (Object.keys(PANELS) as PanelKind[]).flatMap((kind) => {
    const entry = panelOf(kind)
    const launcher = entry.launcher
    if (!launcher || entry.instance || (launcher.group && !group)) return []
    return [{ kind: kind as FixedKind, label: entry.label as string, key: launcher.key }]
  })
}
