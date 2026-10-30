import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import * as huge from "@hugeicons/core-free-icons"

const ICONS = {
  search: "Search01Icon",
  shield: "Shield01Icon",
  wallet: "Wallet01Icon",
  plus: "PlusSignIcon",
  minus: "MinusSignIcon",
  close: "Cancel01Icon",
  check: "Tick02Icon",
  "chevron-down": "ArrowDown01Icon",
  "chevron-up": "ArrowUp01Icon",
  "chevron-left": "ArrowLeft01Icon",
  "chevron-right": "ArrowRight01Icon",
  "arrow-up": "ArrowUp02Icon",
  "arrow-down": "ArrowDown02Icon",
  back: "ArrowLeft01Icon",
  reply: "ArrowTurnBackwardIcon",
  undo: "Undo02Icon",
  reset: "RefreshIcon",
  compose: "PencilEdit02Icon",
  edit: "PencilEdit01Icon",
  chat: "Message01Icon",
  message: "BubbleChatIcon",
  group: "UserGroupIcon",
  user: "UserCircleIcon",
  settings: "Settings02Icon",
  "sidebar-left": "SidebarLeftIcon",
  "sidebar-right": "SidebarRightIcon",
  pin: "PinIcon",
  "pin-fill": "PinIcon",
  unpin: "PinOffIcon",
  mute: "NotificationOff01Icon",
  more: "MoreHorizontalIcon",
  menu: "Menu01Icon",
  link: "Link04Icon",
  external: "LinkSquare02Icon",
  copy: "Copy01Icon",
  share: "Share08Icon",
  trash: "Delete02Icon",
  archive: "Archive02Icon",
  attach: "Attachment01Icon",
  at: "AtIcon",
  enter: "ArrowTurnBackwardIcon",
  image: "Image01Icon",
  file: "File01Icon",
  "file-text": "File02Icon",
  folder: "Folder01Icon",
  "folder-open": "FolderOpenIcon",
  "folder-tree": "HierarchyIcon",
  memory: "AiBrain01Icon",
  tasks: "TaskDone01Icon",
  todo: "CheckListIcon",
  info: "InformationCircleIcon",
  help: "HelpCircleIcon",
  model: "CubeIcon",
  reasoning: "BulbIcon",
  appearance: "PaintBoardIcon",
  integrations: "Plug01Icon",
  skills: "MagicWand01Icon",
  command: "CommandLineIcon",
  signout: "Logout03Icon",
  key: "Key01Icon",
  board: "DashboardSquare01Icon",
  play: "PlayIcon",
  pause: "PauseIcon",
  stop: "StopIcon",
  repeat: "RepeatIcon",
  scan: "ScanIcon",
  globe: "Globe02Icon",
  clock: "Clock01Icon",
  lock: "LockIcon",
  monitor: "ComputerIcon",
  sparkles: "SparklesIcon",
  eye: "EyeIcon",
  react: "SmileDizzyIcon",
  download: "Download01Icon",
  "wrap-text": "TextWrapIcon",
  code: "SourceCodeIcon",
  table: "Table01Icon",
  grid: "GridViewIcon",
  "file-add": "FileAddIcon",
  "folder-add": "FolderAddIcon",
  terminal: "ComputerTerminal01Icon",
  "alert-circle": "AlertCircleIcon",
  "alert-triangle": "Alert02Icon",
  "check-circle": "CheckmarkCircle02Icon",
  loader: "Loading03Icon",
  wrench: "Wrench01Icon",
  "file-view": "FileSearchIcon",
  cursor: "Cursor01Icon",
  worker: "Robot01Icon",
  move: "FolderTransferIcon",
  browser: "BrowserIcon",
  notes: "StickyNote01Icon",
  book: "Book02Icon",
  send: "SentIcon",
  leaf: "Leaf01Icon",
  sliders: "SlidersHorizontalIcon",
  dashboard: "DashboardSquare01Icon",
  bolt: "FlashIcon",
  "filter-horizontal": "FilterHorizontalIcon",
  upload: "Upload04Icon",
  "cloud-upload": "CloudUploadIcon",
  api: "ApiIcon",
} as const

const LUCIDE = {
  "expand-all":
    '<path d="m7 15 5 5 5-5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="m7 9 5-5 5 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>',
  "collapse-all":
    '<path d="m7 20 5-5 5 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="m7 4 5 5 5-5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>',
  maximize:
    '<path d="M15 3h6v6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="m21 3-7 7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="m3 21 7-7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M9 21H3v-6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>',
  minimize:
    '<path d="m14 10 7-7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M20 10h-6V4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="m3 21 7-7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M4 14h6v6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>',
  gauge:
    '<path d="m12 14 4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M3.34 19a10 10 0 1 1 17.32 0" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>',
} as const

type Node = readonly [tag: string, attrs: Readonly<Record<string, string>>]

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const short = (value: string) => value.replace(/\d*\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100))

function svgOf(nodes: readonly Node[], solid: boolean): string {
  return nodes
    .map(([tag, attrs]) => {
      const pairs = Object.entries(solid ? { ...attrs, fill: "currentColor" } : attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${kebab(key)}="${short(String(value))}"`)
      return `<${tag} ${pairs.join(" ")}/>`
    })
    .join("")
}

const table = huge as unknown as Record<string, readonly Node[] | undefined>
const rows = Object.entries(ICONS).map(([name, icon]) => {
  const nodes = table[icon]
  if (!nodes) throw new Error(`no hugeicon named ${icon}`)
  const id = name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())
  return `export const ${id}Icon = ${JSON.stringify(svgOf(nodes, name.endsWith("-fill")))} as Glyph`
})

const lucideRows = Object.entries(LUCIDE).map(([name, body]) => {
  const id = name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())
  return `export const ${id}Icon = ${JSON.stringify(body)} as Glyph`
})

const out = `// Generated by scripts/gen-icons.ts. Do not edit.
// Glyphs from Hugeicons (@hugeicons/core-free-icons), MIT License, Copyright (c) 2025 Hugeicons.
// Gauge, maximize, minimize, expand-all and collapse-all from Lucide, ISC License, Copyright (c) Lucide Contributors.
// One export per glyph, so a chunk carries only the glyphs it imports.

/** A glyph's svg body on a 24 unit grid, stroked with the text color. */
export type Glyph = string & { readonly glyph: true }

${[...rows, ...lucideRows].join("\n")}
`
writeFileSync(resolve(import.meta.dirname, "../packages/ui/src/icons.gen.ts"), out)
console.log(`wrote ${rows.length + lucideRows.length} icons`)
