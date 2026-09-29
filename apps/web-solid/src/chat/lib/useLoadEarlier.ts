import { createEffect, onCleanup } from "solid-js";
import { decideLoadEarlier, PRELOAD_MARGIN_PX } from "./loadEarlier";

export function useLoadEarlier(options: {
  root: () => HTMLElement | undefined;
  sentinel: () => HTMLElement | undefined;
  hasOlder: () => boolean;
  isLoading: () => boolean;
  onLoad: () => void;
}) {
  createEffect(() => {
    const root = options.root();
    const sentinel = options.sentinel();
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") return;

    let armed = true;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const decision = decideLoadEarlier(entry.isIntersecting, {
          armed,
          isLoading: options.isLoading(),
          hasOlder: options.hasOlder(),
        });
        armed = decision.armed;
        if (decision.shouldLoad) options.onLoad();
      },
      { root, rootMargin: `${PRELOAD_MARGIN_PX}px 0px 0px 0px` },
    );

    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });
}
