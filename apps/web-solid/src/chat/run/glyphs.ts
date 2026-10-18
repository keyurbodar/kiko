import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/remix-icon"
import type { StepIcon } from "./run-log"

/*
 * The glyph each step icon draws. Its own module because the run tree is in first paint and the run
 * panel is a lazy chunk: both draw the same icons, and the tree must not pull the panel in.
 */
export const GLYPH: Record<StepIcon, Glyph> = {
  "file-view": glyphs.FileViewIcon,
  folder: glyphs.FolderIcon,
  "file-add": glyphs.FileAddIcon,
  edit: glyphs.EditIcon,
  copy: glyphs.CopyIcon,
  trash: glyphs.TrashIcon,
  "folder-add": glyphs.FolderAddIcon,
  move: glyphs.MoveIcon,
  terminal: glyphs.TerminalIcon,
  link: glyphs.LinkIcon,
  globe: glyphs.GlobeIcon,
  search: glyphs.SearchIcon,
  cursor: glyphs.CursorIcon,
  eye: glyphs.EyeIcon,
  code: glyphs.CodeIcon,
  "file-text": glyphs.FileTextIcon,
  browser: glyphs.BrowserIcon,
  monitor: glyphs.MonitorIcon,
  chat: glyphs.ChatIcon,
  help: glyphs.HelpIcon,
  memory: glyphs.MemoryIcon,
  notes: glyphs.NotesIcon,
  book: glyphs.BookIcon,
  clock: glyphs.ClockIcon,
  tasks: glyphs.TasksIcon,
  group: glyphs.GroupIcon,
  integrations: glyphs.IntegrationsIcon,
  sparkles: glyphs.SparklesIcon,
  scan: glyphs.ScanIcon,
  worker: glyphs.WorkerIcon,
  stop: glyphs.StopIcon,
  send: glyphs.SendIcon,
  skills: glyphs.SkillsIcon,
  wrench: glyphs.WrenchIcon,
  "alert-circle": glyphs.AlertCircleIcon,
  app: glyphs.IntegrationsIcon,
}
