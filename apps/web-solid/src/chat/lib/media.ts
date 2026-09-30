import type { MediaItem } from "../../lib/types";

/**
 * The still that stands in for an item where it is not being watched: the poster
 * frame of a clip in an album cell or a quote, otherwise the image itself.
 *
 * tweb's `MediaVideoPlayer` makes the same choice for its poster element, and
 * the reason is the same: an inline `<video>` inside a transcript cell is a
 * second scroll target and a second set of chrome inside a bubble that already
 * has chrome, and the bytes of the clip are the expensive part — a poster is
 * one frame's worth. So every surface that shows an item WITHOUT playing it
 * asks this, and only the viewer mounts a player.
 *
 * `undefined` for no item, so a caller can hand it a possibly-absent item
 * without branching first.
 */
export function mediaThumbnail(item: MediaItem | undefined): string | undefined {
  if (!item) return undefined;
  return item.kind === "video" ? (item.poster ?? item.src) : item.src;
}