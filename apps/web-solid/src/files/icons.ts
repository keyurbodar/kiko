import type { Glyph } from "@kiko/ui/remix-icon"
import {
	FileAudioIcon,
	FileCsvIcon,
	FileDiffIcon,
	FileHtmlIcon,
	FileIcon,
	FileImageIcon,
	FileJsonIcon,
	FileMarkdownIcon,
	FilePdfIcon,
	FileSourceIcon,
	FileVideoIcon,
} from "@kiko/ui/icons"
import type { ViewerKind } from "./kind"

/** The glyph that stands for each kind of file in the file header. */
export const KIND_ICON: Record<ViewerKind, Glyph> = {
	markdown: FileMarkdownIcon,
	json: FileJsonIcon,
	csv: FileCsvIcon,
	html: FileHtmlIcon,
	diff: FileDiffIcon,
	text: FileSourceIcon,
	image: FileImageIcon,
	pdf: FilePdfIcon,
	audio: FileAudioIcon,
	video: FileVideoIcon,
	other: FileIcon,
}
