import type { Context } from "@earendil-works/pi-ai"

type Schema = Record<string, unknown>

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"])

const isString = (value: unknown): value is string => typeof value === "string"
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const validType = (type: unknown): boolean =>
  isString(type)
    ? TYPES.has(type)
    : Array.isArray(type) && type.length > 0 && type.every((t) => isString(t) && TYPES.has(t))

const validPattern = (pattern: unknown): boolean => {
  if (!isString(pattern)) return false
  try {
    return new RegExp(pattern, "u") instanceof RegExp
  } catch {
    return false
  }
}

const KEEP: Record<string, (value: unknown) => boolean> = {
  type: validType,
  description: isString,
  title: isString,
  format: isString,
  pattern: validPattern,
  enum: (v) => Array.isArray(v) && v.length > 0,
  const: () => true,
  default: () => true,
  examples: Array.isArray,
  minimum: isNumber,
  maximum: isNumber,
  exclusiveMinimum: isNumber,
  exclusiveMaximum: isNumber,
  multipleOf: (v) => isNumber(v) && v > 0,
  minLength: isCount,
  maxLength: isCount,
  minItems: isCount,
  maxItems: isCount,
  minProperties: isCount,
  maxProperties: isCount,
  uniqueItems: (v) => typeof v === "boolean",
  required: (v) => Array.isArray(v) && v.every(isString),
  $ref: isString,
}

const SUBSCHEMA = new Set(["additionalProperties", "items", "not", "contains", "propertyNames", "if", "then", "else"])
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"])
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs"])

function legacyBound(out: Schema, value: Schema, flag: "exclusiveMinimum" | "exclusiveMaximum"): void {
  const bound = flag === "exclusiveMinimum" ? "minimum" : "maximum"
  if (value[flag] === true && isNumber(value[bound])) {
    out[flag] = value[bound]
    delete out[bound]
  }
}

function keyword(out: Schema, key: string, child: unknown, value: Schema): void {
  if (key === "$ref" && isString(child)) out.$ref = child.replace("#/definitions/", "#/$defs/")
  else if (KEEP[key]?.(child)) out[key] = child
  else if (SUBSCHEMA.has(key) && (typeof child === "boolean" || isSchema(child))) out[key] = clean(child)
  else if (key === "items" && Array.isArray(child)) {
    out.prefixItems = child.map(clean)
    if (value.additionalItems === false || isSchema(value.additionalItems)) out.items = clean(value.additionalItems)
  } else if (SCHEMA_LISTS.has(key) && Array.isArray(child) && child.length > 0) out[key] = child.map(clean)
  else if (SCHEMA_MAPS.has(key) && isSchema(child)) out[key] = cleanMap(child)
}

function cleanMap(map: Schema): Schema {
  return Object.fromEntries(Object.entries(map).map(([name, s]) => [name, clean(s)]))
}

function clean(value: unknown): unknown {
  if (typeof value === "boolean") return value
  if (!isSchema(value)) return {}
  const out: Schema = {}
  for (const [key, child] of Object.entries(value)) keyword(out, key, child, value)
  if (isSchema(value.definitions)) out.$defs = { ...cleanMap(value.definitions), ...(out.$defs as Schema | undefined) }
  legacyBound(out, value, "exclusiveMinimum")
  legacyBound(out, value, "exclusiveMaximum")
  return out
}

function toolParameters(parameters: unknown): Schema {
  const out = clean(parameters)
  const { allOf: _all, anyOf: _any, oneOf: _one, ...schema } = isSchema(out) ? out : {}
  return { ...schema, type: "object", properties: isSchema(schema.properties) ? schema.properties : {} }
}

export function withDraft2020Tools<C extends Context>(context: C): C {
  if (!context.tools?.length) return context
  return {
    ...context,
    tools: context.tools.map((tool) => ({
      ...tool,
      parameters: toolParameters(tool.parameters) as typeof tool.parameters,
    })),
  }
}
