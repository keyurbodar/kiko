// Every type that crosses the network. This entry has no runtime dependency.
// Its only runtime code is the id patterns and the room id generator in `ids.ts`, and the
// pure chat list rules in `chats.ts`, the small pure helpers of `activity.ts` that the
// room and the client share, and the attachment limits of `attachments.ts`.
//
// `@yuki/protocol/schema` has the Effect schemas, for the server and the CLI.
// `@yuki/protocol/fixtures` has sample frames, for tests and the mock room.

export * from "./chats"
export * from "./activity"
export * from "./attachments"
export type * from "./envelope"
export * from "./extensions"
export * from "./ids"
export type * from "./loops"
export type * from "./memory"
export type * from "./rich-text"
export type * from "./room"
export type * from "./routines"
export * from "./search"
export type * from "./user"
