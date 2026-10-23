export class CliError extends Error {}

export interface Context {
  url: string
  json: boolean
  args: string[]
  idle: number
  dev: boolean
  name: string
  list: boolean
  noModel: boolean
  fake: boolean
  runs: string
  tail?: string
}
