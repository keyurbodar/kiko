# Actual Cloudflare request budget probe

The proposed self-RPC isolation is false on the tested Cloudflare Workers Free runtime. A local Miniflare pass did not reveal this because its 60-fetch control also passed. These deployed tests count successful responses whose body contains `Example Domain`; they do not measure latency or CPU.

| Deployed case | External requests completed | Errors | Peak overlapping runs |
|---|---|---|---:|
| One invocation requests 60 | 50 | Too many subrequests | 1 |
| Three self-RPC calls request 45 each | 17, 18, 17 | All three exceed quota | 3 requested |
| One alarm fans out three self-RPC calls | 17, 17, 18 | All three exceed quota | 3 requested |
| Three distinct alarms retain work through waitUntil | 31, 19, 0 | All three exceed quota | 3 measured |
| Three fully awaited alarms, next scheduled after settlement | 45, 45, 45 | None | 1 measured |

The last two paths each make one additional request that holds for 2.5 seconds before the 45 external requests. The hold makes overlapping work observable. These are one correctness run per case, with the same quota control and response validation. The slight overshoot above 50 in the concurrent fan-out is observed evidence, not a higher allowance.

The selected free-plan fallback is one fully awaited agent run per real alarm, with a durable queue and stable continuation IDs. Calling the same object's stub or keeping work in waitUntil does not establish a fresh independent quota. Twenty admitted requests may queue; this evidence does not prove twenty simultaneous model runs are safe. Opaque model SDK traffic and uninstrumented platform calls remain outside application fetch counters.

`results.json`, `overlap-results.json`, and `serial-results.json` are the raw returned results. `provenance.json` records deployed version IDs and successful removal of the temporary Worker. The production Kiko Worker was not changed by these probes.

To reproduce on a free-plan account, choose a unique Worker name and private route prefix in the isolated configuration and source, deploy it with Wrangler, then call `<prefix>/control`, `<prefix>/self`, and `<prefix>/alarm` (read `<prefix>/result`). Call `<prefix>/overlap` and poll `<prefix>/overlap-result`; then repeat with `<prefix>/serial`. Use fresh probe state for each campaign. Remove the temporary Worker when finished. Do not apply explicit CPU limits on the Free plan; Cloudflare refuses that upload. Requests in this run used `User-Agent: kiko-quota-verification/1` because the default Python agent initially received an HTTP 403 before any probe result.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object state and waitUntil](https://developers.cloudflare.com/durable-objects/api/state/#waituntil), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/). Retrieved directly through the supplied Cloudflare documentation indexes, without web search.
