import type { KikoError } from "@kiko/protocol"

/** What the human sees when a Durable Object threw while handling something they did. */
export const STORAGE_ERROR: KikoError = { code: "storage", message: "Kiko could not save that. Try again." }
