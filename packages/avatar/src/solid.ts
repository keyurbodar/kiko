import { createRenderEffect, splitProps, type JSX } from "solid-js";
import type { AvatarOptions } from "./index";
import { cachedUri } from "./uri";

export interface AvatarProps extends AvatarOptions {
  name: string;
  class?: string;
  alt?: string;
}

export function Avatar(props: AvatarProps): JSX.Element {
  const [local, options] = splitProps(props, ["name", "class", "alt"]);
  const img = document.createElement("img");
  img.decoding = "async";
  img.draggable = false;
  createRenderEffect(() => {
    img.src = cachedUri(local.name, { ...options });
    img.alt = local.alt ?? "";
    if (local.class) img.className = local.class;
    if (options.size) img.width = img.height = options.size;
  });
  return img;
}
