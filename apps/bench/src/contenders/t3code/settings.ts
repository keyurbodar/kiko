import { PROVIDER_INSTANCE_ID } from "./constants"

export interface ProviderEnvironmentVariable {
  readonly name: string
  readonly value: string
}

export interface SettingsInput {
  readonly shimCommand: string
  readonly shimArgs: readonly string[]
  readonly environment: readonly ProviderEnvironmentVariable[]
}

export const settingsJson = (input: SettingsInput): string =>
  JSON.stringify(
    {
      providerInstances: {
        [PROVIDER_INSTANCE_ID]: {
          driver: "acpRegistry",
          enabled: true,
          environment: input.environment,
          config: {
            source: "local",
            enabled: true,
            commandPath: input.shimCommand,
            commandArgs: input.shimArgs,
            customModels: ["default"],
          },
        },
      },
    },
    null,
    2,
  )
