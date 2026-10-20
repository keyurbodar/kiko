import { serveAsset } from "./lib/assets"

export default {
  fetch: (request, env) => serveAsset(env.ASSETS, request),
} satisfies ExportedHandler<{ ASSETS: Fetcher }>
