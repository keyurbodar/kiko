// Every type that crosses the network. This entry has no runtime dependency.
// Its only runtime code is the id patterns in `ids.ts`.
//
// `@kiko/protocol/schema` has the Effect schemas, for the server and the CLI.
// `@kiko/protocol/fixtures` has sample frames, for tests and the mock room.

export type * from "./envelope"
export * from "./ids"
export type * from "./rich-text"
export type * from "./room"
export type * from "./user"
