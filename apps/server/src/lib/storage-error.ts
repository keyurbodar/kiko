import { StorageError } from "@kiko/protocol"

export const STORAGE_ERROR = new StorageError({ message: "Kiko could not save that. Try again." })
