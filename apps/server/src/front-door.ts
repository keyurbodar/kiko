// The hosted front door (kiko-app): the hosted client's static files and nothing else. Every person's backend runs
// in their own Cloudflare account. Deployed by issues/bin/deploy-front-door.sh with wrangler.front-door.jsonc.
import { serveAsset } from "./lib/assets"

export default {
  fetch: (request, env) => serveAsset(env.ASSETS, request),
} satisfies ExportedHandler<{ ASSETS: Fetcher }>
