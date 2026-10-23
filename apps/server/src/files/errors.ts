import * as Schema from "effect/Schema"

export class UploadError extends Schema.TaggedError<UploadError>()("UploadError", {
  reason: Schema.Literals(["no_upload", "part_missing", "too_large", "storage_full"]),
  message: Schema.String,
}) {}

export class FileKeyError extends Schema.TaggedError<FileKeyError>()("FileKeyError", {
  key: Schema.String,
  message: Schema.String,
}) {}

export class AgentFilesMissing extends Schema.TaggedError<AgentFilesMissing>()("AgentFilesMissing", {
  message: Schema.String,
}) {}

export class FileRowError extends Schema.TaggedError<FileRowError>()("FileRowError", {
  path: Schema.String,
  message: Schema.String,
}) {}
