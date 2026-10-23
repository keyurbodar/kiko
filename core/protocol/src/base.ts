import * as Schema from "effect/Schema"

export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Id = Schema.String.check(Schema.isMinLength(1))
export const Short = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
export const stored = { seq: Count, at: Count }
