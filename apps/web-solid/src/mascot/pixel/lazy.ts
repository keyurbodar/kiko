import { lazy } from "solid-js"

/** The pixel moments, loaded on first use so a screen that never shows one never fetches it. */
export const Moment = lazy(() => import("./moment"))
