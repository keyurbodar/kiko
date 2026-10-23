export const PROTOCOL = 3

export const speaksRpc = (build: { readonly rpc?: unknown }): boolean => build.rpc === true
