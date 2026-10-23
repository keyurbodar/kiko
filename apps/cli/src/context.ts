export class CliError extends Error {}

export interface Context {
  url: string
  json: boolean
  args: string[]
  idle: number
  dev: boolean
  name?: string
  port?: string
  identity?: string
  runs: string
  tail?: string
}
