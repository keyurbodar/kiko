// The build version comes from the root package.json, read at build time. The protocol is in @kiko/protocol.
import { PROTOCOL } from "@kiko/protocol"
import pkg from "../../../../package.json"

/** What the backend says about itself on `/api/version` and in the hello reply. */
export const BACKEND = { version: pkg.version, protocol: PROTOCOL }
