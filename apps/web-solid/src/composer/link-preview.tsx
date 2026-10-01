import { Show, type JSX } from "solid-js"
import { useI18n } from "@kiko/ui/context/i18n"
import { Icon } from "@kiko/ui/icon"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2"
import { cn } from "../lib/cn"
import { hasWebPageContent } from "../chat/lib/linkPreview"
import type { WebPagePreview } from "../lib/types"

export interface ComposerLinkPreviewProps {
  url: string
  preview: WebPagePreview | null
  onDismiss: () => void
  class?: string
}

export function ComposerLinkPreview(props: ComposerLinkPreviewProps): JSX.Element {
  const i18n = useI18n()
  const page = () => (hasWebPageContent(props.preview ?? undefined) ? props.preview : null)

  return (
    <Show when={page()}>
      {(shown) => (
        <div
          class={cn("composer-link-preview mb-1.5 flex min-h-10 w-full items-center gap-2", props.class)}
          data-component="composer-link-preview"
        >
          <span class="flex size-6 shrink-0 items-center justify-center text-accent">
            <Icon name="link" size="small" />
          </span>

          <a
            class={cn(
              "relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[6px]",
              "bg-accent/10 py-0.5 pe-2 ps-[11px] text-inherit no-underline",
              "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent before:content-['']",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
            )}
            data-component="chat-webpage"
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium leading-[18px] text-accent">
                {shown().site || shown().title}
              </span>
              <span class="truncate text-sm leading-[18px] text-weak">
                {shown().description || props.url}
              </span>
            </span>
            <Show when={shown().media}>
              {(media) => (
                <img
                  class="size-8 shrink-0 rounded-[2px] object-cover"
                  src={media().src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
            </Show>
          </a>

          <IconButtonV2
            class="shrink-0"
            variant="ghost"
            size="small"
            type="button"
            aria-label={i18n.t("ui.common.dismiss")}
            icon={<IconV2 name="xmark-small" class="size-3.5" />}
            onClick={() => props.onDismiss()}
          />
        </div>
      )}
    </Show>
  )
}
