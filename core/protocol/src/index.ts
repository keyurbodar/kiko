// Every type that crosses the network. This entry has no runtime dependency.
// Its only runtime code is the id patterns and the room id generator in `ids.ts`, and the
// pure chat list rules in `chats.ts`, the reasoning levels in `thinking.ts`, the small pure helpers of `activity.ts` that the
// room and the client share, and the attachment limits of `attachments.ts`.

export * from "./human-input"
export * from "./chats"
export * from "./activity"
export * from "./attachments"
export type * from "./envelope"
export type * from "./errors"
export * from "./ids"
export type * from "./loops"
export type * from "./memory"
export type * from "./rich-text"
export { plainText } from "./rich-text"
export type * from "./room"
export type * from "./recipes"
export type * from "./routines"
export * from "./search"
export * from "./thinking"
export * from "./version"
export type * from "./user"
export type * from "./catalog"
export type * from "./providers"
