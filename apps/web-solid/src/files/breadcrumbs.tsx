import { FileIcon } from "@kiko/ui/file-icon"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { createSignal, For, Show } from "solid-js"
import { basename, dirname, ROOT, type TreeIndex } from "./model"

/*
 * The open file's path as crumbs, after t3code's FileBreadcrumbs. The chat's files are the first
 * crumb. Each folder crumb opens a menu of that folder: a file opens, a folder steps into its own
 * list, and "Back to" steps out again, never above the crumb's folder.
 */

const label = (path: string) => (path === ROOT ? "Files" : basename(path))

/** The folders above `path`, from the root down. */
export function crumbFolders(path: string): string[] {
	const out: string[] = []
	for (let dir = dirname(path); ; dir = dirname(dir)) {
		out.unshift(dir)
		if (dir === ROOT) return out
	}
}

export function FileBreadcrumbs(props: { path: string; index: TreeIndex; unsaved: boolean; onOpen: (path: string) => void }) {
	return (
		<nav class="flex min-w-0 flex-1 items-center overflow-x-auto text-xs [scrollbar-width:none]" aria-label="File path" data-component="file-breadcrumbs">
			<For each={crumbFolders(props.path)}>
				{(dir) => (
					<>
						<FolderCrumb dir={dir} current={props.path} index={props.index} onOpen={props.onOpen} />
						<HugeIcon icon={ChevronRightIcon} size={14} class="mx-1 shrink-0 text-muted opacity-60" />
					</>
				)}
			</For>
			<span class="flex min-w-0 shrink-0 items-center" aria-current="page" title={props.path} data-component="file-path">
				<span class="block max-w-40 truncate rounded-sm px-0.5 font-medium text-text">{basename(props.path)}</span>
				<Show when={props.unsaved}>
					<span class="ml-1.5 size-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" data-component="file-unsaved" title="Saving" aria-label="Unsaved changes" />
				</Show>
			</span>
		</nav>
	)
}

function FolderCrumb(props: { dir: string; current: string; index: TreeIndex; onOpen: (path: string) => void }) {
	const [at, setAt] = createSignal(props.dir)
	const children = () => props.index.children.get(at()) ?? []
	return (
		<MenuV2 gutter={4} placement="bottom-start" onOpenChange={(open) => open && setAt(props.dir)}>
			<MenuV2.Trigger
				class="block max-w-40 shrink-0 cursor-pointer truncate rounded-sm px-0.5 text-left text-muted outline-none hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] data-[expanded]:bg-hover data-[expanded]:text-text"
				aria-label={`Browse ${label(props.dir)}`}
				title={props.dir || "Files"}
				data-component="file-crumb"
			>
				{label(props.dir)}
			</MenuV2.Trigger>
			<MenuV2.Portal>
				<MenuV2.Content class="max-h-80 min-w-48 overflow-y-auto" data-component="file-crumb-menu">
					<Show when={at() !== props.dir}>
						<MenuV2.Item closeOnSelect={false} onSelect={() => setAt(dirname(at()))}>
							<HugeIcon icon={BackIcon} class="size-3.5 shrink-0" />
							<span class="truncate">Back to {label(dirname(at()))}</span>
						</MenuV2.Item>
						<MenuV2.Separator />
					</Show>
					<Show when={children().length} fallback={<MenuV2.Item disabled>This folder is empty.</MenuV2.Item>}>
						<For each={children()}>
							{(path) =>
								props.index.folders.has(path) ? (
									<MenuV2.Item closeOnSelect={false} onSelect={() => setAt(path)}>
										<FileIcon node={{ path, type: "directory" }} />
										<span class="min-w-0 flex-1 truncate">{basename(path)}</span>
										<HugeIcon icon={ChevronRightIcon} class="size-3.5 shrink-0 text-muted" />
									</MenuV2.Item>
								) : (
									<MenuV2.Item onSelect={() => props.onOpen(path)} aria-current={path === props.current ? "page" : undefined}>
										<FileIcon node={{ path, type: "file" }} />
										<span class={`min-w-0 flex-1 truncate ${path === props.current ? "font-medium" : ""}`}>{basename(path)}</span>
									</MenuV2.Item>
								)
							}
						</For>
					</Show>
				</MenuV2.Content>
			</MenuV2.Portal>
		</MenuV2>
	)
}
