import type { FileRef } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CodeIcon, CopyIcon, DownloadIcon, EyeIcon, MaximizeIcon, TableIcon, WrapTextIcon } from "@kiko/ui/icons"
import { urls } from "../lib/store"
import { SurfaceAction } from "./chrome"
import { TEXT_KINDS, type ViewerKind } from "./kind"
import { where } from "./model"
import { wrap, setWrap } from "./prefs"
import { FileViewer } from "./viewer"
import type { FileView } from "./view"

/*
 * The header actions and the body of one open file. The panel and the full-size dialog both draw
 * them, so a file looks and behaves the same in either.
 */

const RENDERED_LABELS = {
	markdown: ["Show rendered markdown", "Show markdown source"],
	table: ["Show table", "Show source"],
	html: ["Show rendered page", "Show HTML source"],
} as const

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export function FileActions(props: { view: FileView; chatId: string; path: string; file: FileRef; kind: ViewerKind; onExpand?: () => void }) {
	return (
		<>
			{props.view.mode() && (
				<SurfaceAction
					label={RENDERED_LABELS[props.view.mode()!][props.view.rendered() ? 1 : 0]}
					icon={props.view.rendered() ? CodeIcon : props.view.mode() === "table" ? TableIcon : EyeIcon}
					action="toggle-rendered"
					pressed={props.view.rendered()}
					onPress={() => props.view.toggleRendered(props.view.mode()!)}
				/>
			)}
			{TEXT_KINDS.has(props.kind) && !props.view.rendered() && (
				<SurfaceAction label={wrap() ? "Disable word wrap" : "Enable word wrap"} icon={WrapTextIcon} action="toggle-wrap" pressed={wrap()} onPress={() => setWrap(!wrap())} />
			)}
			{TEXT_KINDS.has(props.kind) && (
				<SurfaceAction label={props.view.copied() ? "Copied" : "Copy contents"} icon={props.view.copied() ? CheckIcon : CopyIcon} action="copy-file" onPress={props.view.copy} />
			)}
			<SurfaceAction
				label="Save file"
				icon={DownloadIcon}
				action="download-file"
				href={urls.file(where(props.chatId, props.path).space, props.file.id)}
				download={baseName(props.path)}
			/>
			{props.onExpand && <SurfaceAction label="Open full size" icon={MaximizeIcon} action="expand-file" onPress={props.onExpand} />}
		</>
	)
}

export function FileBody(props: { chatId: string; path: string; file: FileRef | undefined; kind: ViewerKind; view: FileView }) {
	const at = () => where(props.chatId, props.path)
	return (
		<section class="flex min-w-0 flex-1 flex-col" aria-label={baseName(props.path)} data-component="file-surface">
			<FileViewer
				roomId={at().space}
				path={at().path}
				file={props.file && { ...props.file, name: at().path }}
				kind={props.kind}
				rendered={props.view.rendered()}
				wrap={wrap()}
				reveal={props.view.reveal()}
				onEditorState={props.view.setEditor}
			/>
		</section>
	)
}
