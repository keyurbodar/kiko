import * as Schema from "effect/Schema"

export const ErrorAction = Schema.Literals(["open_models", "open_integrations"])
export type ErrorAction = typeof ErrorAction.Type

export class IntegrationError extends Schema.TaggedError<IntegrationError>()("IntegrationError", {
  integration: Schema.Literals(["composio", "kernel"]),
  reason: Schema.Literals(["missing", "rejected", "down"]),
  message: Schema.String,
  action: Schema.optionalKey(ErrorAction),
}) {}

export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  message: Schema.String,
  action: Schema.optionalKey(ErrorAction),
}) {}

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
}) {}

export class ProtocolError extends Schema.TaggedError<ProtocolError>()("ProtocolError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  resource: Schema.String,
  message: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  message: Schema.String,
}) {}

export class RefusedError extends Schema.TaggedError<RefusedError>()("RefusedError", {
  reason: Schema.String,
  message: Schema.String,
}) {}

export const OwnerError = Schema.Union([
  IntegrationError,
  ModelError,
  StorageError,
  ProtocolError,
  NotFoundError,
  ConflictError,
  RefusedError,
])
export type OwnerError = typeof OwnerError.Type

export const NoticeError = Schema.Union([IntegrationError, ModelError, StorageError, ProtocolError])
export type NoticeError = typeof NoticeError.Type
