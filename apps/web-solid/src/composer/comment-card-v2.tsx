import { createSignal, onMount, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { FileIcon } from "@kiko/ui/file-icon"
import { getFilenameTruncated } from "./path"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { AttachmentCardV2 } from "./attachment-card-v2"

export function CommentCardV2(props: {
  comment: string
  path: string
  selection?: { startLine: number; endLine: number }
  active?: boolean
  title?: string
  tooltip?: boolean
  wide?: boolean
  onClick?: () => void
}) {
  let title: HTMLSpanElement | undefined
  const [truncated, setTruncated] = createSignal(false)

  const sync = (element: HTMLSpanElement) => setTruncated(element.scrollWidth > element.clientWidth)

  createResizeObserver(
    () => title,
    (_rect, element) => sync(element),
  )

  onMount(() => {
    const element = title
    if (!element) return
    const measure = () => requestAnimationFrame(() => sync(element))
    measure()
    void document.fonts?.ready.then(measure)
  })

  return (
    <TooltipV2
      placement="top"
      openDelay={1000}
      value={props.title ?? props.comment}
      disabled={!props.tooltip || !truncated()}
      class={props.wide ? "w-full" : undefined}
      contentStyle={{ "max-width": "320px", "white-space": "pre-wrap" }}
    >
      <AttachmentCardV2
        title={props.comment}
        active={props.active}
        clickable={!!props.onClick}
        wide={props.wide}
        surface="base"
        titleRef={(element) => {
          title = element
        }}
        onClick={props.onClick}
      >
        <FileIcon node={{ path: props.path, type: "file" }} />
        <span>
          {getFilenameTruncated(props.path, 14)}
          <Show when={props.selection}>
            {(sel) =>
              sel().startLine === sel().endLine ? `:${sel().startLine}` : `:${sel().startLine}-${sel().endLine}`
            }
          </Show>
        </span>
      </AttachmentCardV2>
    </TooltipV2>
  )
}
