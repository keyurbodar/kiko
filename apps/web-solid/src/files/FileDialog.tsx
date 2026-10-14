import type { FileRef } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { CloseIcon } from "@kiko/ui/icons"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { Show } from "solid-js"
import { SUBHEADER } from "./chrome"
import { KIND_ICON } from "./icons"
import type { ViewerKind } from "./kind"
import { setFullSize } from "./prefs"
import { FileActions, FileBody } from "./surface"
import { createFileView } from "./view"

export default function FileDialog(props: { chatId: string; path: string; file: FileRef | undefined; kind: ViewerKind }) {
	const view = createFileView(
		props.chatId,
		() => props.path,
		() => props.file,
		() => props.kind,
	)
	return (
		<ModalV2 open onOpenChange={(open: boolean) => !open && setFullSize(false)}>
			<ModalV2.Portal>
				<ModalV2.Overlay />
				<ModalV2.Content class="h-[88vh] w-[min(64rem,92vw)] flex-col overflow-hidden rounded-xl bg-background shadow-2xl" data-component="file-dialog">
					<div class={`${SUBHEADER} h-11 min-h-11`}>
						<HugeIcon icon={KIND_ICON[props.kind]} size={14} />
						<ModalV2.Title class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{props.path}</ModalV2.Title>
						<Show when={props.file} keyed>
							{(file) => <FileActions view={view} chatId={props.chatId} path={props.path} file={file} kind={props.kind} />}
						</Show>
						<ModalV2.Close aria-label="Close full size file" data-action="close-file-dialog" class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
							<HugeIcon icon={CloseIcon} size={14} />
						</ModalV2.Close>
					</div>
					<div class="flex min-h-0 flex-1 overflow-hidden">
						<FileBody chatId={props.chatId} path={props.path} file={props.file} kind={props.kind} view={view} />
					</div>
				</ModalV2.Content>
			</ModalV2.Portal>
		</ModalV2>
	)
}
